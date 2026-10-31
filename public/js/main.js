/* The Geek Gene — interactions */
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const header = document.querySelector(".site-header");
  const progress = document.querySelector(".progress");
  const nav = document.getElementById("site-nav");
  const toggle = document.querySelector(".nav-toggle");
  const parallaxEls = [...document.querySelectorAll("[data-parallax]")];

  /* ---------- header state, progress bar, parallax ---------- */
  let ticking = false;
  const onScroll = () => {
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (header) header.classList.toggle("scrolled", y > 10);
    if (progress) progress.style.setProperty("--progress", max > 0 ? (y / max).toFixed(4) : 0);
    if (!reduceMotion) {
      parallaxEls.forEach((el) => {
        el.style.transform = `translate3d(0, ${y * parseFloat(el.dataset.parallax)}px, 0)`;
      });
    }
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  onScroll();

  /* ---------- mobile nav ---------- */
  const closeNav = () => {
    if (!nav || !toggle) return;
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle?.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav?.addEventListener("click", (e) => { if (e.target.closest("a")) closeNav(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNav(); });

  /* ---------- reveal on scroll (staggered within each group) ---------- */
  const reveals = [...document.querySelectorAll(".reveal")];
  // stagger siblings that share a parent
  const groups = new Map();
  reveals.forEach((el) => {
    const list = groups.get(el.parentElement) || [];
    list.push(el);
    groups.set(el.parentElement, list);
  });
  groups.forEach((list) => list.forEach((el, i) => el.style.setProperty("--delay", `${Math.min(i, 6) * 0.08}s`)));

  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---------- active nav link ---------- */
  const navLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
  const sections = navLinks
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${entry.target.id}`));
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((s) => spy.observe(s));
    // clear highlight when back in the hero
    const hero = document.getElementById("top");
    if (hero) {
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting) navLinks.forEach((a) => a.classList.remove("active"));
      }, { rootMargin: "-45% 0px -50% 0px" }).observe(hero);
    }
  }

  /* ---------- card spotlight follows cursor ---------- */
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });

  /* ---------- count-up stats ---------- */
  const counters = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window && !reduceMotion) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach(({ isIntersecting, target }) => {
        if (!isIntersecting) return;
        cio.unobserve(target);
        const end = Number(target.dataset.count);
        const suffix = target.dataset.suffix || "";
        const start = performance.now();
        const dur = 1400;
        const step = (t) => {
          const p = Math.min((t - start) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          target.textContent = Math.round(end * eased) + suffix;
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    counters.forEach((c) => cio.observe(c));
  }

  /* ---------- footer year ---------- */
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  /* ---------- contact form ---------- */
  const form = document.getElementById("contact-form");
  if (form) {
    const status = form.querySelector(".form-status");
    const button = form.querySelector('button[type="submit"]');
    const setStatus = (msg, kind) => {
      status.textContent = msg;
      status.className = `form-status field-full ${kind || ""}`;
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // client-side validation
      let valid = true;
      form.querySelectorAll("[required]").forEach((input) => {
        const ok = input.checkValidity() && input.value.trim() !== "";
        input.closest(".field").classList.toggle("invalid", !ok);
        if (!ok) valid = false;
      });
      if (!valid) {
        setStatus("Please fill in your name, a valid email and a message.", "err");
        return;
      }

      const data = Object.fromEntries(new FormData(form));
      if (!data["cf-turnstile-response"]) {
        setStatus("Please complete the verification check.", "err");
        return;
      }

      button.disabled = true;
      setStatus("Sending…");
      try {
        const res = await fetch(form.action, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.error || "Something went wrong.");
        form.reset();
        setStatus("Thanks! Your message is on its way — we'll be in touch soon.", "ok");
      } catch (err) {
        setStatus(`${err.message} Please try again in a moment.`, "err");
      } finally {
        button.disabled = false;
        window.turnstile?.reset();
      }
    });

    form.addEventListener("input", (e) => {
      e.target.closest(".field")?.classList.remove("invalid");
    });
  }
})();
