// Toasts announce actions; menus and dialogs own keyboard input until closed.
export function hasOpenKeyboardOverlay() {
  return [
    ...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-shortcut-capture]',
    ),
  ].some((node) => !node.closest('[data-slot="toast"], [data-ending-style], [hidden]'));
}
