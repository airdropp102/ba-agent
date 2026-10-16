/** Keep live metrics, disclosure state and keyboard focus stable during polling. */
export function patchQualityDashboard(current, next) {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName ||
      current.dataset?.qualityKey !== next.dataset?.qualityKey) {
    current.replaceWith(next);
    return;
  }
  if (current.nodeType === Node.TEXT_NODE) {
    if (current.data !== next.data) current.data = next.data;
    return;
  }
  // `open` belongs to the reader after the first render, including when data changes.
  for (const {name} of [...current.attributes]) {
    if (name !== 'open' && !next.hasAttribute(name)) current.removeAttribute(name);
  }
  for (const {name, value} of next.attributes) {
    if (name !== 'open' && current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
  const incoming = [...next.childNodes];
  for (let i = 0; i < incoming.length; i++) {
    const child = incoming[i], key = child.dataset?.qualityKey;
    let existing = current.childNodes[i];
    if (key && existing?.dataset?.qualityKey !== key) {
      const matching = [...current.children].find(node => node.dataset.qualityKey === key);
      if (matching) { current.insertBefore(matching, existing || null); existing = matching; }
      else { current.insertBefore(child, existing || null); continue; }
    } else if (existing?.dataset?.qualityKey && existing.dataset.qualityKey !== key) {
      current.insertBefore(child, existing); continue;
    }
    if (existing) patchQualityDashboard(existing, child);
    else current.append(child);
  }
  while (current.childNodes.length > incoming.length) current.lastChild.remove();
}
