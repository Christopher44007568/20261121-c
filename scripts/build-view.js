// Bundles the browser view into a single self-contained HTML file in
// dist/index.html by inlining the small ES-module dependency graph.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seen = new Map();

async function loadModule(absPath) {
  if (seen.has(absPath)) return seen.get(absPath);
  let source = await readFile(absPath, "utf8");
  const imports = [...source.matchAll(/import\s+(?:[^;]*?)\s+from\s+"(\.[^"]+)";/g)];
  for (const match of imports) {
    const depPath = resolve(dirname(absPath), match[1]);
    await loadModule(depPath);
  }
  seen.set(absPath, source);
  return source;
}

const entry = resolve(root, "view/view.js");
await loadModule(entry);
const order = [...seen.keys()];
const names = new Map(order.map((path, index) => [path, `m${index}`]));

function transformModule(path) {
  let source = seen.get(path)
    .replace(/import\s+\{([\s\S]*?)\}\s+from\s+"(\.[^"]+)";/g, (_m, block, spec) =>
      `import { ${block.replace(/\s+/g, " ").trim()} } from "${spec}";`);
  const exportNames = [];
  source = source.replace(/export\s+(?:function|class|const|let|var)\s+([A-Za-z0-9_]+)/g, (_m, name) => {
    exportNames.push(name);
    return _m.replace("export ", "");
  });
  source = source.replace(/export\s*\{([^}]+)\};?/g, (_m, block) => {
    for (const part of block.split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) exportNames.push(name);
    }
    return "";
  });
  source = source.replace(/import\s+\{([^}]+)\}\s+from\s+"(\.[^"]+)";/g, (_m, block, spec) => {
    const depPath = resolve(dirname(path), spec);
    const depName = names.get(depPath);
    const lines = block.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      const local = (alias ?? orig).trim();
      return `const ${local} = ${depName}.${orig.trim()};`;
    });
    return lines.join("\n");
  });
  const body = exportNames.length
    ? `${source}\nreturn { ${exportNames.join(", ")} };`
    : source;
  return `const ${names.get(path)} = (() => {\n${body}\n})();`;
}

const bundled = order
  .map((path) => `// module: ${path.replace(root, ".")}\n${transformModule(path)}`)
  .join("\n\n");

let html = await readFile(resolve(root, "view/index.html"), "utf8");
const css = await readFile(resolve(root, "view/style.css"), "utf8");
html = html.replace(
  /<link rel="stylesheet" href="\.\/style\.css" \/>/,
  `<style>\n${css}\n</style>`,
);
html = html.replace(
  /<script type="module" src="\.\/view\.js"><\/script>\s*<script type="module">[\s\S]*?<\/script>/,
  `<script type="module">\n${bundled}\ninit();\n</script>`,
);

await mkdir(resolve(root, "dist"), { recursive: true });
await writeFile(resolve(root, "dist/index.html"), html);
console.log("wrote dist/index.html");
