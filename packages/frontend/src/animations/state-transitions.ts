import { animate } from "animejs";

export function enterActive(overlay: HTMLElement) {
  return animate(overlay, {
    opacity: [0, 1],
    scale: [0.9, 1],
    duration: 300,
    ease: "outExpo",
  });
}

export function dimPassive(board: HTMLElement) {
  return animate(board, {
    opacity: [1, 0.5],
    filter: ["blur(0px)", "blur(2px)"],
    duration: 300,
    ease: "outExpo",
  });
}

export function restorePassive(board: HTMLElement) {
  return animate(board, {
    opacity: [0.5, 1],
    filter: ["blur(2px)", "blur(0px)"],
    duration: 300,
    ease: "outExpo",
  });
}
