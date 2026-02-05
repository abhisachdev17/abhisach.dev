/**
 * GPU Fluid Simulation - Ambient Mode
 * Based on: https://github.com/abhisachdev17/GPU-Fluid-Simulation
 * Modified for gentle autonomous motion as website background
 */

let gl;
let canvas;
let JACOBI_ITERATIONS = 20;
let floatExt;
let supportLinear;
let currentTheme = 'dark';

// Simulation parameters
const CONFIG = {
  timeStep: 0.1,
  splatRadius: 0.00008,
  velocityMultiplier: 2000,
  densityIntensity: 0.3,
};

// Get current theme
function getFluidTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

// Listen for theme changes
window.addEventListener('themechange', (e) => {
  currentTheme = e.detail.theme;
});


function initFluid() {
  // Initialize theme
  currentTheme = getFluidTheme();

  canvas = document.getElementById('fluid-canvas');
  if (!canvas) {
    console.error('Fluid canvas not found');
    return;
  }

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  console.log('Canvas size:', canvas.width, 'x', canvas.height);

  gl = canvas.getContext('webgl');
  if (!gl) {
    console.error('WebGL not supported');
    return;
  }
  console.log('WebGL context created');

  floatExt = gl.getExtension('OES_texture_half_float');
  supportLinear = gl.getExtension('OES_texture_half_float_linear');

  if (!floatExt) {
    console.error('OES_texture_half_float not supported');
    return;
  }
  console.log('Float texture extension available');

  initFrameBuffers();
  console.log('Framebuffers initialized');

  initPrograms();
  console.log('Programs initialized');

  initQuad();
  console.log('Quad initialized');

  simulateFluid();
  console.log('Simulation started');
}

// FBO Texture class
class FBOTexture {
  constructor(w, h) {
    gl.activeTexture(gl.TEXTURE0);
    this.texture = gl.createTexture();
    this.createTexture(w, h);

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.texture,
      0
    );
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.texelSizeX = 1.0 / w;
    this.texelSizeY = 1.0 / h;
  }

  createTexture(w, h) {
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      floatExt.HALF_FLOAT_OES,
      null
    );
  }

  bind(num) {
    gl.activeTexture(gl.TEXTURE0 + num);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    return num;
  }
}

let divergence, fDensity, fVelocity, fPressure;
let bDensity, bVelocity, bPressure;

function initFrameBuffers() {
  const width = canvas.width;
  const height = canvas.height;

  fDensity = new FBOTexture(width, height);
  bDensity = new FBOTexture(width, height);
  fVelocity = new FBOTexture(width, height);
  bVelocity = new FBOTexture(width, height);
  fPressure = new FBOTexture(width, height);
  bPressure = new FBOTexture(width, height);
  divergence = new FBOTexture(width, height);
}

// Program class
class Program {
  constructor(vertexShaderText, fragmentShaderText) {
    this.program = createProgram(vertexShaderText, fragmentShaderText);
  }

  bind() {
    gl.useProgram(this.program);
  }

  getUniform(name) {
    return gl.getUniformLocation(this.program, name);
  }
}

function createProgram(vertexShaderText, fragmentShaderText) {
  const program = gl.createProgram();
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

  gl.shaderSource(vertexShader, vertexShaderText);
  gl.shaderSource(fragmentShader, fragmentShaderText);
  gl.compileShader(vertexShader);
  gl.compileShader(fragmentShader);

  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    console.error('Vertex shader error:', gl.getShaderInfoLog(vertexShader));
  }
  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    console.error('Fragment shader error:', gl.getShaderInfoLog(fragmentShader));
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
  }

  return program;
}

let splatProgram, advectionProgram, divergenceProgram;
let pressureProgram, gradientSubtractProgram, mainProgram, fadeProgram;

function initPrograms() {
  const vertexShader = document.getElementById('vertexShader').innerHTML;

  splatProgram = new Program(
    vertexShader,
    document.getElementById('splatShader').innerHTML
  );
  advectionProgram = new Program(
    vertexShader,
    document.getElementById('advectShader').innerHTML
  );
  divergenceProgram = new Program(
    vertexShader,
    document.getElementById('divergenceShader').innerHTML
  );
  pressureProgram = new Program(
    vertexShader,
    document.getElementById('jacobiShader').innerHTML
  );
  gradientSubtractProgram = new Program(
    vertexShader,
    document.getElementById('gradientSubtractShader').innerHTML
  );
  mainProgram = new Program(
    vertexShader,
    document.getElementById('fragmentShader').innerHTML
  );
  fadeProgram = new Program(
    vertexShader,
    document.getElementById('fadeShader').innerHTML
  );
}

// Quad geometry
let quadBuffer, indexBuffer;

function initQuad() {
  const quad = new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]);
  quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
}

function drawOnScreen(program, frameBuffer) {
  // Re-bind buffers before drawing
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

  const positionALoc = gl.getAttribLocation(program.program, 'vertPosition');
  gl.vertexAttribPointer(positionALoc, 2, gl.FLOAT, false, 2 * Float32Array.BYTES_PER_ELEMENT, 0);
  gl.enableVertexAttribArray(positionALoc);
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

function step(timestep) {
  gl.disable(gl.BLEND);
  gl.viewport(0, 0, canvas.width, canvas.height);

  // Advect velocity
  advectionProgram.bind();
  gl.uniform2f(advectionProgram.getUniform('texelSize'), fVelocity.texelSizeX, fVelocity.texelSizeY);
  gl.uniform1i(advectionProgram.getUniform('toAdvect'), fVelocity.bind(0));
  gl.uniform1i(advectionProgram.getUniform('inputVelocity'), fVelocity.bind(1));
  gl.uniform1f(advectionProgram.getUniform('timeStep'), timestep);
  drawOnScreen(advectionProgram, bVelocity.fbo);

  // Compute divergence
  divergenceProgram.bind();
  gl.uniform2f(divergenceProgram.getUniform('texelSize'), bVelocity.texelSizeX, bVelocity.texelSizeY);
  gl.uniform1i(divergenceProgram.getUniform('inputVelocity'), bVelocity.bind(0));
  drawOnScreen(divergenceProgram, divergence.fbo);

  // Pressure solve (Jacobi iterations)
  pressureProgram.bind();
  gl.uniform2f(pressureProgram.getUniform('texelSize'), bVelocity.texelSizeX, bVelocity.texelSizeY);
  gl.uniform1i(pressureProgram.getUniform('bTex'), divergence.bind(0));
  gl.uniform1f(pressureProgram.getUniform('alpha'), -1.0 / 8.0);
  gl.uniform1f(pressureProgram.getUniform('inverseBeta'), 0.25);

  for (let i = 0; i < JACOBI_ITERATIONS; i++) {
    gl.uniform1i(pressureProgram.getUniform('xTex'), fPressure.bind(1));
    drawOnScreen(pressureProgram, bPressure.fbo);
    [fPressure, bPressure] = [bPressure, fPressure];
  }

  [fVelocity, bVelocity] = [bVelocity, fVelocity];

  // Gradient subtraction
  gradientSubtractProgram.bind();
  gl.uniform2f(gradientSubtractProgram.getUniform('texelSize'), fVelocity.texelSizeX, fVelocity.texelSizeY);
  gl.uniform1i(gradientSubtractProgram.getUniform('pressure'), fPressure.bind(0));
  gl.uniform1i(gradientSubtractProgram.getUniform('velocity'), fVelocity.bind(1));
  drawOnScreen(gradientSubtractProgram, bVelocity.fbo);

  // Advect density
  advectionProgram.bind();
  gl.uniform2f(advectionProgram.getUniform('texelSize'), fVelocity.texelSizeX, fVelocity.texelSizeY);
  gl.uniform1i(advectionProgram.getUniform('toAdvect'), fDensity.bind(0));
  gl.uniform1i(advectionProgram.getUniform('inputVelocity'), bVelocity.bind(1));
  gl.uniform1f(advectionProgram.getUniform('timeStep'), timestep);
  drawOnScreen(advectionProgram, bDensity.fbo);

  // Fade
  fadeProgram.bind();
  gl.uniform2f(fadeProgram.getUniform('texelSize'), bDensity.texelSizeX, bDensity.texelSizeY);
  gl.uniform1i(fadeProgram.getUniform('tex'), bDensity.bind(0));
  drawOnScreen(fadeProgram, fDensity.fbo);

  [fVelocity, bVelocity] = [bVelocity, fVelocity];
  [fPressure, bPressure] = [bPressure, fPressure];
}

function addDensity(posX, posY, r, g, b) {
  splatProgram.bind();
  gl.uniform1i(splatProgram.getUniform('tex'), fDensity.bind(0));
  gl.uniform2f(splatProgram.getUniform('point'), posX, posY);
  gl.uniform3f(splatProgram.getUniform('color'), r, g, b);
  gl.uniform1f(splatProgram.getUniform('radius'), CONFIG.splatRadius);
  drawOnScreen(splatProgram, bDensity.fbo);

  [fDensity, bDensity] = [bDensity, fDensity];
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function addVelocity(posX, posY, dirX, dirY) {
  splatProgram.bind();
  gl.uniform1i(splatProgram.getUniform('tex'), fVelocity.bind(0));
  gl.uniform2f(splatProgram.getUniform('point'), posX, posY);
  gl.uniform3f(splatProgram.getUniform('color'),
    dirX * CONFIG.velocityMultiplier,
    dirY * CONFIG.velocityMultiplier,
    0.0
  );
  gl.uniform1f(splatProgram.getUniform('radius'), CONFIG.splatRadius);
  drawOnScreen(splatProgram, bVelocity.fbo);

  [fVelocity, bVelocity] = [bVelocity, fVelocity];
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}


// Two cursors with wandering behavior
let cursors = [
  {
    x: 0.3,
    y: 0.5,
    angle: Math.random() * Math.PI * 2,
    speed: 0.0025,
    turnSpeed: 0,
    nextTurnChange: 0
  },
  {
    x: 0.7,
    y: 0.5,
    angle: Math.random() * Math.PI * 2,
    speed: 0.002,
    turnSpeed: 0,
    nextTurnChange: 0
  }
];

// Get cursor colors based on current theme
function getCursorColors() {
  if (currentTheme === 'light') {
    return [
      { r: 0.15, g: 0.15, b: 0.15 }, // Dark gray
      { r: 0.12, g: 0.10, b: 0.08 }  // Warm dark
    ];
  }
  return [
    { r: 0.35, g: 0.35, b: 0.35 }, // Cool white
    { r: 0.38, g: 0.34, b: 0.28 }  // Warm beige
  ];
}

function simulateFluid() {
  let frameCount = 0;

  function updateCursor(cursor, index) {
    // Store previous position
    const prevX = cursor.x;
    const prevY = cursor.y;

    // Change turn rate periodically for varied curves (gentler turns)
    if (frameCount > cursor.nextTurnChange) {
      cursor.turnSpeed = (Math.random() - 0.5) * 0.05;
      cursor.nextTurnChange = frameCount + 60 + Math.random() * 120;
    }

    // Update angle with smooth turning
    cursor.angle += cursor.turnSpeed;

    // Add some waviness (offset by index for variety)
    const waveOffset = Math.sin(frameCount * 0.05 + index * 2) * 0.03;

    // Move in current direction
    cursor.x += Math.cos(cursor.angle + waveOffset) * cursor.speed;
    cursor.y += Math.sin(cursor.angle + waveOffset) * cursor.speed;

    // Bounce off edges with some randomness
    if (cursor.x < 0.1 || cursor.x > 0.9) {
      cursor.angle = Math.PI - cursor.angle + (Math.random() - 0.5) * 0.5;
      cursor.x = Math.max(0.1, Math.min(0.9, cursor.x));
    }
    if (cursor.y < 0.1 || cursor.y > 0.9) {
      cursor.angle = -cursor.angle + (Math.random() - 0.5) * 0.5;
      cursor.y = Math.max(0.1, Math.min(0.9, cursor.y));
    }

    // Calculate movement delta
    const dx = cursor.x - prevX;
    const dy = cursor.y - prevY;

    // Add density and velocity with theme-based color
    const colors = getCursorColors();
    const color = colors[index];
    addDensity(cursor.x, cursor.y, color.r, color.g, color.b);
    addVelocity(cursor.x, cursor.y, dx, dy);
  }

  function draw(timestamp) {
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Set clear color based on theme
    if (currentTheme === 'light') {
      gl.clearColor(0.96, 0.96, 0.96, 1.0); // Light gray to match --bg-color
    } else {
      gl.clearColor(0.02, 0.02, 0.02, 1.0); // Near black
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    frameCount++;

    // Update both cursors
    cursors.forEach((cursor, index) => updateCursor(cursor, index));

    step(CONFIG.timeStep);

    // Render to screen
    mainProgram.bind();
    gl.uniform2f(mainProgram.getUniform('texelSize'), fDensity.texelSizeX, fDensity.texelSizeY);
    gl.uniform1i(mainProgram.getUniform('tex'), fDensity.bind(0));
    gl.uniform1f(mainProgram.getUniform('isLightMode'), currentTheme === 'light' ? 1.0 : 0.0);
    if (currentTheme === 'light') {
      gl.uniform3f(mainProgram.getUniform('bgColor'), 0.96, 0.96, 0.96);
    } else {
      gl.uniform3f(mainProgram.getUniform('bgColor'), 0.02, 0.02, 0.02);
    }
    drawOnScreen(mainProgram, null);

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}

// Handle resize - with debounce and threshold to avoid mobile scroll issues
let resizeTimeout;
let lastWidth = 0;
let lastHeight = 0;

function handleResize() {
  if (!canvas || !gl) return;

  const newWidth = window.innerWidth;
  const newHeight = window.innerHeight;

  // Only resize if width changed, or height changed significantly (more than 150px)
  // This prevents mobile address bar show/hide from triggering resize
  const widthChanged = Math.abs(newWidth - lastWidth) > 0;
  const heightChangedSignificantly = Math.abs(newHeight - lastHeight) > 150;

  if (!widthChanged && !heightChangedSignificantly) {
    return;
  }

  // Debounce the actual resize
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    lastWidth = newWidth;
    lastHeight = newHeight;
    canvas.width = newWidth;
    canvas.height = newHeight;

    // Reinitialize framebuffers with new size
    initFrameBuffers();
  }, 250);
}

// Initialize on load
window.addEventListener('load', () => {
  lastWidth = window.innerWidth;
  lastHeight = window.innerHeight;
  initFluid();
});
window.addEventListener('resize', handleResize);
