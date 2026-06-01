import { animate } from "animejs";

export type CounterFormat = "cost" | "tokens";

export function animateCounter(element: HTMLElement, from: number, to: number, format: CounterFormat = "cost") {
  const obj = { value: from };
  return animate(obj, {
    value: to,
    duration: 500,
    ease: "outExpo",
    onUpdate: () => {
      element.textContent = format === "cost"
        ? `$${obj.value.toFixed(2)}`
        : Math.round(obj.value).toLocaleString();
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
