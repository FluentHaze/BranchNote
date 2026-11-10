const buttons = [...document.querySelectorAll("button")];
document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (button) void window.trayMenu.action(button.dataset.action);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") void window.trayMenu.action("dismiss");
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length].focus();
  }
});
