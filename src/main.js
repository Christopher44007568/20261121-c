import { ContactShadowRenderer } from "./renderer.js";

const canvas = document.querySelector("#gl");
const errorBox = document.querySelector("#error");
const probePanel = document.querySelector(".probe");
const probeReticle = document.querySelector("#probe-reticle");
const viewModes = {
  beauty: 0,
  shadow: 1,
  steps: 2,
  basis: 3,
  reference: 4,
  compare: 5
};

let renderer;
let frameHandle = 0;
let probeVisible = true;

function showError(error) {
  console.error(error);
  errorBox.hidden = false;
  errorBox.textContent = error instanceof Error ? error.stack || error.message : String(error);
  window.__contactDemoError = String(error);
}

function formatProbe(probe) {
  document.querySelector("#probe-mode").textContent = probe.auto ? "AUTO" : "PIN";
  document.querySelector("#probe-pixel").textContent = `${probe.pixel[0]} , ${probe.pixel[1]}`;
  document.querySelector("#probe-steps").textContent = String(probe.steps).padStart(2, "0");
  document.querySelector("#probe-mip").textContent = String(probe.mip);
  document.querySelector("#probe-basis").textContent = probe.basisName;
  document.querySelector("#probe-gap").textContent =
    probe.gap == null ? "—" : `${probe.gap.toFixed(3)} m`;
  document.querySelector("#probe-ref").textContent =
    probe.referenceOccluded ? "occluded" : "clear";
  document.querySelector("#probe-note").textContent = probe.note;
  document.querySelector("#frame-time").textContent =
    `${probe.frameMilliseconds.toFixed(1)} ms`;

  const gapNode = document.querySelector("#probe-gap");
  gapNode.style.color = probe.basis === 1 ? "#42d9a2" : "";
  const refNode = document.querySelector("#probe-ref");
  refNode.style.color = probe.referenceOccluded ? "#e0b061" : "#c7d0d2";
  probeReticle.style.left = `${probe.pixel[0]}px`;
  probeReticle.style.top = `${probe.pixel[1]}px`;
  probeReticle.hidden = !probeVisible;
}

function setActive(selector, element) {
  for (const button of document.querySelectorAll(selector)) {
    button.classList.toggle("active", button === element);
  }
}

function renderNow(time = performance.now()) {
  if (!renderer) return;
  try {
    const probe = renderer.render(time);
    if (probeVisible) formatProbe(probe);
    window.__contactDemoReady = true;
    window.__contactDemoFrame = (window.__contactDemoFrame || 0) + 1;
  } catch (error) {
    showError(error);
  }
}

function requestRender() {
  if (frameHandle) cancelAnimationFrame(frameHandle);
  frameHandle = requestAnimationFrame((time) => {
    frameHandle = 0;
    renderNow(time);
  });
}

function animate(time) {
  if (!renderer?.orbit) return;
  renderNow(time);
  frameHandle = requestAnimationFrame(animate);
}

function setView(name) {
  if (!(name in viewModes)) throw new Error(`Unknown view: ${name}`);
  renderer.setView(viewModes[name]);
  document.body.classList.toggle("compare", name === "compare");
  const button = document.querySelector(`[data-view="${name}"]`);
  if (button) setActive("#view-buttons button", button);
  renderNow();
}

function setShot(name) {
  renderer.setShot(name);
  const button = document.querySelector(`[data-shot="${name}"]`);
  if (button) setActive("#shot-buttons button", button);
  renderNow();
}

async function boot() {
  try {
    renderer = new ContactShadowRenderer(canvas);
    renderer.setShot("near");
    renderer.setView(viewModes.beauty);
    document.querySelectorAll("#view-buttons button").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });
    document.querySelectorAll("#shot-buttons button").forEach((button) => {
      button.addEventListener("click", () => setShot(button.dataset.shot));
    });

    const slider = document.querySelector("#ray-length");
    const output = document.querySelector("#ray-output");
    slider.addEventListener("input", () => {
      renderer.setRayLength(Number(slider.value));
      output.textContent = `${renderer.rayLength.toFixed(2)} m`;
      renderNow();
    });
    output.textContent = `${renderer.rayLength.toFixed(2)} m`;

    const orbit = document.querySelector("#orbit");
    orbit.addEventListener("change", () => {
      renderer.setOrbit(orbit.checked);
      if (frameHandle) cancelAnimationFrame(frameHandle);
      frameHandle = 0;
      if (orbit.checked) frameHandle = requestAnimationFrame(animate);
      else renderNow();
    });

    document.querySelector("#probe-close").addEventListener("click", () => {
      probeVisible = false;
      probePanel.hidden = true;
      probeReticle.hidden = true;
    });
    canvas.addEventListener("pointerdown", (event) => {
      renderer.setUserProbe(event.clientX, event.clientY);
      probeVisible = true;
      probePanel.hidden = false;
      probeReticle.hidden = false;
      renderNow();
    });

    window.addEventListener("resize", () => {
      renderer.resize();
      renderNow();
    });

    window.contactDemo = {
      setView,
      setShot,
      setRayLength(value) {
        slider.value = String(value);
        slider.dispatchEvent(new Event("input"));
      },
      setProbePixel(x, y) {
        renderer.setUserProbe(x, y);
        probePanel.hidden = false;
        probeVisible = true;
        renderNow();
      },
      resetProbe() {
        renderer.resetAutoProbe();
        renderNow();
      },
      render: renderNow,
      getProbe: () => renderer.lastProbe,
      readDepth: (x, y) => renderer.debugReadDepth(x, y),
      readTraceRect: (x, y, w, h) => renderer.debugReadTraceRect(x, y, w, h),
      getState: () => ({
        view: renderer.viewMode,
        shot: renderer.shotName,
        rayLength: renderer.rayLength,
        width: renderer.width,
        height: renderer.height,
        probe: renderer.lastProbe
      })
    };
    renderNow();
  } catch (error) {
    showError(error);
  }
}

boot();
