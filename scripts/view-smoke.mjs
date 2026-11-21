// Headless smoke test for the view module using minimal DOM/canvas stubs.

const noop = () => {};
const contextStub = new Proxy({}, {
  get: () => () => {},
  set: () => true,
});

const elements = new Map();
function makeElement(id) {
  return {
    id,
    value: "",
    checked: true,
    children: [],
    innerHTML: "",
    textContent: "",
    dataset: {},
    classList: { toggle: noop },
    addEventListener: noop,
    appendChild(child) {
      this.children.push(child);
    },
    getContext: () => contextStub,
  };
}

globalThis.document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  },
  createElement: () => makeElement("dynamic"),
  querySelectorAll: () => [],
};

const { init } = await import("../view/view.js");
init();

const fixtureSelect = elements.get("fixture");
if (!fixtureSelect.children.length) throw new Error("fixture options were not populated");
const metrics = elements.get("metrics").innerHTML;
if (!metrics.includes("多边形数")) throw new Error("metrics were not rendered");
console.log("view smoke OK:", fixtureSelect.children.length, "fixtures; metrics rendered");
