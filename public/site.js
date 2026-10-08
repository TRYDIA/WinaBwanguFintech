document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".menu-toggle");
  const menu = document.getElementById("site-menu");
  const backdrop = document.querySelector(".menu-backdrop");

  if (!toggle || !menu || !backdrop) {
    return;
  }

  function setMenuOpen(isOpen) {
    document.body.classList.toggle("menu-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  }

  toggle.addEventListener("click", () => {
    setMenuOpen(!document.body.classList.contains("menu-open"));
  });

  backdrop.addEventListener("click", () => setMenuOpen(false));

  menu.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => setMenuOpen(false));
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      setMenuOpen(false);
    }
  });
});
