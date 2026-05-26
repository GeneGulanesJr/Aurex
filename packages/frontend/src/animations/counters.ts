import { animate } from "animejs";

export function animateCounter(element: HTMLElement, from: number, to: number) {
  const obj = { value: from };
  return animate(obj, {
    value: to,
    duration: 500,
    ease: "outExpo",
    onUpdate: () => {
      element.textContent = `$${obj.value.toFixed(2)}`;
    },
  });
}

export function animateProgress(bar: HTMLElement, fromPercent: number, toPercent: number) {
  return animate(bar, {
    width: [`${fromPercent}%`, `${toPercent}%`],
    duration: 600,
    ease: "outExpo",
  });
}
