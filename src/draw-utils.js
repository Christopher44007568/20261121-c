export function shade(hex, factor) {
  const value = hex.replace("#", "");
  const numbers = [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
  const adjusted = numbers.map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel * factor))));
  return `rgb(${adjusted.join(",")})`;
}

export function withAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

export function pathFromPoints(context, points, close = true) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  if (close) context.closePath();
}

export function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

export function drawArrow(context, from, to, color) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 6;
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(
    to.x - Math.cos(angle - Math.PI / 6) * size,
    to.y - Math.sin(angle - Math.PI / 6) * size,
  );
  context.moveTo(to.x, to.y);
  context.lineTo(
    to.x - Math.cos(angle + Math.PI / 6) * size,
    to.y - Math.sin(angle + Math.PI / 6) * size,
  );
  context.strokeStyle = color;
  context.stroke();
}

export function truncateText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}
