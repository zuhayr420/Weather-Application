/**
 * weatherEffects.js
 * -----------------
 * Full-screen dynamic atmospheric weather canvas:
 * - Fluid animated aurora & sky waves (Clear / Day / Night)
 * - Drifting volumetric atmospheric clouds
 * - Dynamic slant rain & ripple splashes
 * - Soft drifting snowflakes with depth
 * - Thunderstorm with dramatic lightning arcs
 * - Shimmering golden sun rays & thermal motes for hot/dry weather
 */
(() => {
  let canvas = document.getElementById("weatherEffectsCanvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "weatherEffectsCanvas";
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "-1";
    document.body.appendChild(canvas);
  }

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  let width = 0;
  let height = 0;
  let animationFrameId = null;
  let lastTimestamp = 0;
  let accumulatedTime = 0;

  // Active effect configuration
  let currentEffect = "clear"; // 'rain' | 'snow' | 'storm' | 'hot' | 'fog' | 'clear' | 'cloudy'
  let isNight = false;
  let particles = [];
  let clouds = [];
  let splashes = [];
  let lightningTimer = 0;
  let flashAlpha = 0;

  function resize() {
    // Sharp high-DPI canvas matching display refresh
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.scale(dpr, dpr);
    initAtmosphere(currentEffect);
  }

  window.addEventListener("resize", resize);

  function initAtmosphere(effect) {
    particles = [];
    splashes = [];
    clouds = [];

    // Continuous floating clouds across sky
    const cloudCount = effect === "cloudy" || effect === "fog" ? 6 : (effect === "rain" || effect === "storm" ? 8 : 4);
    for (let i = 0; i < cloudCount; i++) {
      clouds.push({
        x: Math.random() * (width + 400) - 200,
        y: Math.random() * (height * 0.45),
        radius: 120 + Math.random() * 180,
        speedX: 0.15 + Math.random() * 0.35,
        alpha: effect === "storm" ? 0.35 : 0.18 + Math.random() * 0.14,
      });
    }

    if (effect === "rain" || effect === "storm") {
      const count = effect === "storm" ? Math.floor(width * 0.4) : Math.floor(width * 0.26);
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * (width + 200) - 100,
          y: Math.random() * height,
          length: 18 + Math.random() * 22,
          speedY: 18 + Math.random() * 14,
          speedX: -2.5 - Math.random() * 2,
          alpha: 0.3 + Math.random() * 0.45,
          width: 1 + Math.random() * 1.4,
        });
      }
    } else if (effect === "snow") {
      const count = Math.floor(width * 0.2);
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: 1.5 + Math.random() * 3,
          speedY: 0.7 + Math.random() * 1.6,
          speedX: -0.4 + Math.random() * 0.8,
          alpha: 0.4 + Math.random() * 0.5,
          angle: Math.random() * Math.PI * 2,
          spinSpeed: 0.015 + Math.random() * 0.02,
        });
      }
    } else if (effect === "hot") {
      const count = Math.floor(width * 0.08);
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: 2.5 + Math.random() * 4,
          speedY: -0.4 - Math.random() * 0.6,
          speedX: -0.3 + Math.random() * 0.6,
          alpha: 0.2 + Math.random() * 0.35,
          pulse: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  function drawFluidSkyWaves(time) {
    // Subtle, gentle atmospheric background gradient
    const t = time * 0.0003;
    
    // Wave 1: Soft upper ambient curve
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, height * 0.3);
    for (let x = 0; x <= width; x += 40) {
      const y = height * 0.24 + Math.sin(x * 0.002 + t) * 25 + Math.cos(x * 0.0015 - t * 0.6) * 20;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, 0);
    ctx.closePath();

    const waveGrad1 = ctx.createLinearGradient(0, 0, width, height * 0.35);
    if (currentEffect === "hot") {
      waveGrad1.addColorStop(0, "rgba(254, 215, 170, 0.08)");
      waveGrad1.addColorStop(1, "rgba(253, 230, 138, 0.03)");
    } else if (currentEffect === "storm") {
      waveGrad1.addColorStop(0, "rgba(109, 40, 217, 0.09)");
      waveGrad1.addColorStop(1, "rgba(30, 58, 138, 0.05)");
    } else if (currentEffect === "rain") {
      waveGrad1.addColorStop(0, "rgba(125, 211, 252, 0.08)");
      waveGrad1.addColorStop(1, "rgba(148, 163, 184, 0.04)");
    } else if (currentEffect === "snow") {
      waveGrad1.addColorStop(0, "rgba(224, 242, 254, 0.12)");
      waveGrad1.addColorStop(1, "rgba(255, 255, 255, 0.04)");
    } else {
      waveGrad1.addColorStop(0, "rgba(186, 230, 253, 0.08)");
      waveGrad1.addColorStop(1, "rgba(221, 214, 254, 0.04)");
    }
    ctx.fillStyle = waveGrad1;
    ctx.fill();
    ctx.restore();

    // Wave 2: Lower counter-flowing wave
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, height * 0.75);
    for (let x = 0; x <= width; x += 40) {
      const y = height * 0.8 + Math.cos(x * 0.0025 - t * 0.7) * 28 + Math.sin(x * 0.0015 + t * 0.4) * 18;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();

    const waveGrad2 = ctx.createLinearGradient(0, height * 0.7, width, height);
    if (currentEffect === "hot") {
      waveGrad2.addColorStop(0, "rgba(254, 243, 199, 0.04)");
      waveGrad2.addColorStop(1, "rgba(253, 186, 116, 0.07)");
    } else if (currentEffect === "storm") {
      waveGrad2.addColorStop(0, "rgba(59, 130, 246, 0.04)");
      waveGrad2.addColorStop(1, "rgba(147, 51, 234, 0.08)");
    } else {
      waveGrad2.addColorStop(0, "rgba(224, 238, 252, 0.05)");
      waveGrad2.addColorStop(1, "rgba(238, 235, 252, 0.07)");
    }
    ctx.fillStyle = waveGrad2;
    ctx.fill();
    ctx.restore();
  }

  function drawVolumetricClouds(dt) {
    const factor = dt / 16.67;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      c.x += c.speedX * factor;
      if (c.x - c.radius > width) {
        c.x = -c.radius * 2;
        c.y = Math.random() * (height * 0.45);
      }

      const grad = ctx.createRadialGradient(c.x, c.y, 10, c.x, c.y, c.radius);
      const cloudAlpha = c.alpha * 0.55;
      if (currentEffect === "storm") {
        grad.addColorStop(0, `rgba(75, 85, 99, ${cloudAlpha})`);
        grad.addColorStop(1, "rgba(75, 85, 99, 0)");
      } else if (currentEffect === "rain") {
        grad.addColorStop(0, `rgba(148, 163, 184, ${cloudAlpha})`);
        grad.addColorStop(1, "rgba(148, 163, 184, 0)");
      } else {
        grad.addColorStop(0, `rgba(255, 255, 255, ${cloudAlpha})`);
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSunRays(time) {
    if (currentEffect !== "hot" && currentEffect !== "clear") return;
    const rayCount = 6;
    const originX = width * 0.85;
    const originY = -50;
    const rayLength = Math.max(width, height) * 1.1;

    ctx.save();
    for (let i = 0; i < rayCount; i++) {
      const angle = (Math.PI * 0.28) + (i * 0.14) + Math.sin(time * 0.0003 + i) * 0.02;
      const x2 = originX + Math.cos(angle) * rayLength;
      const y2 = originY + Math.sin(angle) * rayLength;

      const grad = ctx.createLinearGradient(originX, originY, x2, y2);
      const intensity = currentEffect === "hot" ? 0.06 : 0.03;
      grad.addColorStop(0, `rgba(253, 224, 71, ${intensity + Math.sin(time * 0.001 + i) * 0.015})`);
      grad.addColorStop(0.6, `rgba(251, 191, 36, ${intensity * 0.3})`);
      grad.addColorStop(1, "transparent");

      ctx.strokeStyle = grad;
      ctx.lineWidth = 25 + i * 10;
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function render(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const dt = Math.min(timestamp - lastTimestamp, 32); // frame delta in ms
    lastTimestamp = timestamp;
    accumulatedTime += dt;
    const factor = dt / 16.67;

    ctx.clearRect(0, 0, width, height);

    // 1. Fluid Sky Waves (Interpolated by precise timestamp)
    drawFluidSkyWaves(accumulatedTime);

    // 2. Volumetric Clouds
    drawVolumetricClouds(dt);

    // 3. Sun Ray Flares
    drawSunRays(accumulatedTime);

    // 4. Lightning Flash (Storm)
    if (currentEffect === "storm") {
      lightningTimer += factor;
      if (lightningTimer > 150 && Math.random() < 0.022 * factor) {
        flashAlpha = 0.4 + Math.random() * 0.4;
        lightningTimer = 0;
      }
      if (flashAlpha > 0) {
        ctx.fillStyle = `rgba(240, 246, 255, ${flashAlpha})`;
        ctx.fillRect(0, 0, width, height);
        flashAlpha *= Math.pow(0.86, factor);
        if (flashAlpha < 0.01) flashAlpha = 0;
      }
    }

    // 5. Rain & Splashes
    if (currentEffect === "rain" || currentEffect === "storm") {
      ctx.strokeStyle = currentEffect === "storm" ? "rgba(186, 230, 253, 0.75)" : "rgba(147, 197, 253, 0.7)";
      ctx.lineCap = "round";

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        ctx.lineWidth = p.width;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.speedX * 1.5, p.y + p.length);
        ctx.stroke();

        p.y += p.speedY * factor;
        p.x += p.speedX * factor;

        if (p.y > height) {
          if (splashes.length < 35 && Math.random() < 0.4 * factor) {
            splashes.push({ x: p.x, y: height - 10 + Math.random() * 8, radius: 2, alpha: 0.6 });
          }
          p.y = -p.length;
          p.x = Math.random() * (width + 120);
        }
      }

      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        ctx.strokeStyle = `rgba(186, 230, 253, ${s.alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, s.radius * 2, s.radius * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
        s.radius += 0.8 * factor;
        s.alpha *= Math.pow(0.85, factor);
        if (s.alpha < 0.02) splashes.splice(i, 1);
      }
    }

    // 6. Snowflakes
    else if (currentEffect === "snow") {
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.angle += p.spinSpeed * factor;
        p.x += (Math.sin(p.angle) * 0.9 + p.speedX) * factor;
        p.y += p.speedY * factor;

        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        if (p.y > height) {
          p.y = -p.radius * 2;
          p.x = Math.random() * width;
        }
      }
    }

    // 7. Thermal Sun Motes (Hot/Dry)
    else if (currentEffect === "hot") {
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.pulse += 0.035 * factor;
        p.y += p.speedY * factor;
        p.x += (Math.sin(p.pulse) * 0.5 + p.speedX) * factor;

        const currentAlpha = p.alpha * (0.6 + 0.4 * Math.sin(p.pulse));
        ctx.fillStyle = `rgba(245, 158, 11, ${currentAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        if (p.y < -10) {
          p.y = height + 10;
          p.x = Math.random() * width;
        }
      }
    }

    animationFrameId = requestAnimationFrame(render);
  }

  function applyAtmosphere(data) {
    if (!data || !data.current) return;
    const cur = data.current;
    const code = cur.weather_code ?? 0;
    const tempC = weatherService.state.unit === "fahrenheit"
      ? (cur.temperature_2m - 32) * (5 / 9)
      : cur.temperature_2m;
    isNight = cur.is_day === 0;

    let effect = "clear";
    let weatherClass = "weather-clear";

    if ([95, 96, 99].includes(code)) {
      effect = "storm";
      weatherClass = "weather-storm";
    } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
      effect = "rain";
      weatherClass = "weather-rain";
    } else if ([56, 57, 66, 67, 71, 73, 75, 77, 85, 86].includes(code)) {
      effect = "snow";
      weatherClass = "weather-snow";
    } else if ([45, 48].includes(code)) {
      effect = "fog";
      weatherClass = "weather-fog";
    } else if ([0, 1].includes(code) && tempC >= 28) {
      effect = "hot";
      weatherClass = "weather-dry";
    } else if ([2, 3].includes(code)) {
      effect = "cloudy";
      weatherClass = "weather-cloudy";
    }

    let tempClass = "temp-mild";
    if (tempC >= 32) {
      tempClass = "temp-scorching";
    } else if (tempC >= 26) {
      tempClass = "temp-hot";
    } else if (tempC <= 0) {
      tempClass = "temp-freezing";
    } else if (tempC <= 10) {
      tempClass = "temp-cold";
    }

    const body = document.body;
    const existingClasses = Array.from(body.classList);
    existingClasses.forEach((cls) => {
      if (cls.startsWith("weather-") || cls.startsWith("temp-")) {
        body.classList.remove(cls);
      }
    });

    body.classList.add(weatherClass, tempClass);
    body.dataset.weatherState = `${weatherClass} ${tempClass}`;

    if (effect !== currentEffect) {
      currentEffect = effect;
      initAtmosphere(effect);
    }
  }

  document.addEventListener("weatherUpdated", (e) => {
    applyAtmosphere(e.detail?.data);
  });

  resize();
  if (!animationFrameId) {
    animationFrameId = requestAnimationFrame(render);
  }
})();
