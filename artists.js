(() => {
  const root = document.documentElement;
  const home = document.querySelector("#artist-home");
  const room = document.querySelector(".listening-room");
  const header = document.querySelector(".topbar");
  let visited = false;

  function showView(focus = true) {
    const inRoom = location.hash === "#jake-miller";
    root.dataset.view = inRoom ? "room" : "artists";
    home.inert = inRoom;
    room.inert = !inRoom;
    header.inert = !inRoom;
    document.title = inRoom ? "Jake Miller · Listening Room" : "Encore · Artist Rooms";
    document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
    visited ||= inRoom;
    document.querySelector("#return-room").hidden = !visited;
    window.scrollTo(0, 0);
    if (inRoom) {
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
    if (focus) {
      (inRoom ? document.querySelector(".room-back") : document.querySelector("#enter-jake")).focus({ preventScroll: true });
    }
  }

  window.addEventListener("hashchange", () => showView());
  showView(false);
})();
