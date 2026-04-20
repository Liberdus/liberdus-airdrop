const DEFAULT_COLORS = Object.freeze([
  "#fbaf40",
  "#79f4bc",
  "#6f99ff",
  "#fff0d3",
  "#d8e4ff",
]);

const DEFAULT_SHAPES = Object.freeze([
  "streamer",
  "streamer",
  "rect",
  "rect",
  "circle",
]);

function noop() {}

function createNoopController() {
  return {
    burst: noop,
    celebrate: noop,
    clear: noop,
    destroy: noop,
  };
}

function randomBetween(min, max) {
  return min + (Math.random() * (max - min));
}

function pickRandom(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function createClaimConfettiController(canvas, {
  colors = DEFAULT_COLORS,
  shapes = DEFAULT_SHAPES,
  disableForReducedMotion = true,
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return createNoopController();
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return createNoopController();
  }

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    cssWidth: 1,
    cssHeight: 1,
    particles: [],
    frameId: null,
    timers: new Set(),
    destroyed: false,
  };

  const resize = () => {
    if (state.destroyed) return;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(rect.width || 0, 1);
    const cssHeight = Math.max(rect.height || 0, 1);
    const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);

    state.cssWidth = cssWidth;
    state.cssHeight = cssHeight;

    const nextWidth = Math.round(cssWidth * pixelRatio);
    const nextHeight = Math.round(cssHeight * pixelRatio);

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, state.cssWidth, state.cssHeight);
  };

  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => resize())
    : null;

  const stopLoop = () => {
    if (!state.frameId) return;
    window.cancelAnimationFrame(state.frameId);
    state.frameId = null;
  };

  const clearTimers = () => {
    for (const timerId of state.timers) {
      window.clearTimeout(timerId);
    }
    state.timers.clear();
  };

  const clearCanvas = () => {
    context.clearRect(0, 0, state.cssWidth, state.cssHeight);
  };

  const clear = () => {
    clearTimers();
    stopLoop();
    state.particles = [];
    clearCanvas();
  };

  const drawParticle = (particle) => {
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(particle.rotation);
    context.globalAlpha = particle.opacity;
    context.fillStyle = particle.color;

    const wobbleScale = clamp(0.28 + (Math.abs(Math.cos(particle.wobble)) * 0.72), 0.18, 1);

    if (particle.shape === "circle") {
      context.scale(1, wobbleScale);
      context.beginPath();
      context.arc(0, 0, particle.width * 0.5, 0, Math.PI * 2);
      context.fill();
    } else {
      context.scale(wobbleScale, 1);
      context.fillRect(
        -particle.width / 2,
        -particle.height / 2,
        particle.width,
        particle.height,
      );
    }

    context.restore();
  };

  const updateParticle = (particle) => {
    particle.life += 1;
    particle.opacity = Math.max(0, 1 - (particle.life / particle.ticks));
    particle.x += particle.velocityX;
    particle.y += particle.velocityY;
    particle.velocityX = (particle.velocityX * particle.decay) + particle.drift;
    particle.velocityY = (particle.velocityY * particle.decay) + particle.gravity;
    particle.rotation += particle.spin;
    particle.wobble += particle.wobbleSpeed;

    return particle.life < particle.ticks
      && particle.opacity > 0.01
      && particle.y < (state.cssHeight + 40)
      && particle.x > -60
      && particle.x < (state.cssWidth + 60);
  };

  const frame = () => {
    state.frameId = null;
    clearCanvas();

    if (!state.particles.length) {
      return;
    }

    const nextParticles = [];
    for (const particle of state.particles) {
      if (!updateParticle(particle)) continue;
      drawParticle(particle);
      nextParticles.push(particle);
    }

    state.particles = nextParticles;

    if (state.particles.length) {
      state.frameId = window.requestAnimationFrame(frame);
    }
  };

  const ensureLoop = () => {
    if (state.frameId || !state.particles.length) return;
    state.frameId = window.requestAnimationFrame(frame);
  };

  const burst = ({
    particleCount = 48,
    angle = 90,
    spread = 48,
    startVelocity = 15,
    decay = 0.965,
    gravity = 0.24,
    drift = 0,
    ticks = 96,
    scalar = 1,
    origin = { x: 0.5, y: 0.8 },
  } = {}) => {
    if (state.destroyed) return;
    if (disableForReducedMotion && reducedMotionQuery.matches) return;

    resize();

    const originX = clamp(Number(origin.x ?? 0.5), 0, 1) * state.cssWidth;
    const originY = clamp(Number(origin.y ?? 0.8), 0, 1) * state.cssHeight;

    for (let index = 0; index < particleCount; index += 1) {
      const shotAngle = toRadians(angle + randomBetween(-spread / 2, spread / 2));
      const velocity = startVelocity * randomBetween(0.78, 1.16);
      const shape = pickRandom(shapes);
      const size = randomBetween(5, 10) * scalar;

      state.particles.push({
        x: originX,
        y: originY,
        width: shape === "streamer" ? size * randomBetween(1.6, 2.4) : size,
        height: shape === "streamer" ? size * randomBetween(0.48, 0.72) : size,
        color: pickRandom(colors),
        shape,
        velocityX: Math.cos(shotAngle) * velocity,
        velocityY: Math.sin(shotAngle) * velocity * -1,
        gravity: gravity * randomBetween(0.92, 1.12),
        decay: decay * randomBetween(0.996, 1),
        drift: drift + randomBetween(-0.035, 0.035),
        rotation: randomBetween(0, Math.PI * 2),
        spin: randomBetween(-0.16, 0.16),
        wobble: randomBetween(0, Math.PI * 2),
        wobbleSpeed: randomBetween(0.12, 0.26),
        opacity: 1,
        life: 0,
        ticks: Math.round(ticks * randomBetween(0.86, 1.14)),
      });
    }

    ensureLoop();
  };

  const scheduleBurst = (options, delay = 0) => {
    if (delay <= 0) {
      burst(options);
      return;
    }

    const timerId = window.setTimeout(() => {
      state.timers.delete(timerId);
      burst(options);
    }, delay);
    state.timers.add(timerId);
  };

  const celebrate = () => {
    if (state.destroyed) return;
    if (disableForReducedMotion && reducedMotionQuery.matches) {
      clear();
      return;
    }

    clear();
    resize();

    const compact = state.cssWidth < 560 || window.matchMedia("(max-width: 780px)").matches;
    const baseCount = compact ? 56 : 90;
    const followupCount = compact ? 40 : 65;
    const baseVelocity = compact ? 15 : 18.5;
    const scalar = compact ? 1 : 1.1;
    const roundSpacing = compact ? 220 : 250;
    const rounds = [
      {
        offset: 0,
        cornerCount: baseCount,
        centerCount: compact ? 34 : 52,
        velocity: baseVelocity,
        cornerSpread: 46,
        centerSpread: 30,
        ticks: compact ? 105 : 115,
        centerTicks: compact ? 98 : 108,
        cornerScalar: scalar,
        centerScalar: scalar * 1.02,
        originY: 0.05,
      },
      {
        offset: roundSpacing,
        cornerCount: followupCount,
        centerCount: compact ? 28 : 44,
        velocity: baseVelocity - 0.9,
        cornerSpread: 42,
        centerSpread: 28,
        ticks: compact ? 100 : 110,
        centerTicks: compact ? 94 : 104,
        cornerScalar: scalar * 0.98,
        centerScalar: scalar,
        originY: 0.08,
      },
      {
        offset: roundSpacing * 2,
        cornerCount: compact ? 32 : 50,
        centerCount: compact ? 24 : 36,
        velocity: baseVelocity - 1.6,
        cornerSpread: 38,
        centerSpread: 26,
        ticks: compact ? 94 : 102,
        centerTicks: compact ? 88 : 98,
        cornerScalar: scalar * 0.94,
        centerScalar: scalar * 0.96,
        originY: 0.11,
      },
    ];

    for (const round of rounds) {
      scheduleBurst({
        particleCount: round.cornerCount,
        angle: 308,
        spread: round.cornerSpread,
        startVelocity: round.velocity,
        origin: { x: 0.06, y: round.originY },
        ticks: round.ticks,
        scalar: round.cornerScalar,
      }, round.offset);

      scheduleBurst({
        particleCount: round.cornerCount,
        angle: 232,
        spread: round.cornerSpread,
        startVelocity: round.velocity,
        origin: { x: 0.94, y: round.originY },
        ticks: round.ticks,
        scalar: round.cornerScalar,
      }, round.offset + 70);

      scheduleBurst({
        particleCount: round.centerCount,
        angle: 270,
        spread: round.centerSpread,
        startVelocity: round.velocity + 1,
        origin: { x: 0.5, y: Math.max(0.03, round.originY - 0.02) },
        ticks: round.centerTicks,
        scalar: round.centerScalar,
      }, round.offset + 115);
    }
  };

  const destroy = () => {
    state.destroyed = true;
    clear();
    resizeObserver?.disconnect();
    window.removeEventListener("resize", resize);
  };

  resize();
  resizeObserver?.observe(canvas);
  window.addEventListener("resize", resize);

  return {
    burst,
    celebrate,
    clear,
    destroy,
  };
}
