// Asks before deleting a property. Returns true if the person said yes.
export function confirmDelete(p) {
  return window.confirm(
    `Delete "${p.name}"?\n\n` +
      "It will be hidden from the market, monthly rent stops, and open orders are cancelled.\n" +
      "Its record on the blockchain stays, because nothing there can be erased.\n\n" +
      "You can only delete it while no investor holds any of its shares."
  );
}
