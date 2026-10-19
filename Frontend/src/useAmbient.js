import { useEffect } from "react";

// Cards that fade up as they scroll into view. Hero layers are excluded on purpose.
const REVEAL = [
  ".content .panel",
  ".content .stat-card",
  ".content .section-heading",
  ".content .toolbar",
  ".content .announcement",
  ".content .project-card",
  ".impact-strip article",
  ".x-tile",
  ".x-step",
  ".x-news-item",
  ".x-ledger",
  ".x-cta-band",
  ".x-welcome",
  ".x-footer-cols > div",
  ".value",
  ".steps li",
  ".ticker",
].join(",");

// Directional variants for reveals; everything else fades up. Index within siblings drives the stagger.
const REVEAL_LEFT = ".x-welcome-copy, .x-section-head, .x-pagehead-lite, .x-news-item:nth-child(odd)";
const REVEAL_RIGHT = ".x-news-item:nth-child(even), .x-welcome-actions";
const REVEAL_SCALE = ".x-cta-band, .x-tile, .project-card, .stat-card";

const canHover = () => window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Page-wide ambient behaviours, all progressive enhancement:
 *  - scroll progress bar and a navbar that condenses once the page scrolls
 *  - cursor spotlight on cards, pointer parallax in the hero, magnetic buttons
 *  - staggered reveal-on-scroll (an IntersectionObserver; content is plain
 *    visible if it, or JavaScript, is unavailable)
 */
export function useAmbient() {
  useEffect(() => {
    const bar = document.getElementById("scroll-progress");
    let ticking = false;

    const update = () => {
      ticking = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
      document.querySelector(".x-nav")?.toggleAttribute("data-scrolled", window.scrollY > 24);
      // Hero parallax value, only updated while the hero can still be on screen.
      if (window.scrollY < window.innerHeight * 1.2 && !prefersReducedMotion()) {
        document.querySelector(".x-hero")?.style.setProperty("--sy", String(Math.round(window.scrollY)));
      }
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const fine = canHover();
    let frame = 0;
    let event;

    const apply = () => {
      frame = 0;
      const { clientX: x, clientY: y, target } = event;

      const card = target.closest?.(".panel, .stat-card, .value, .impact-strip article");
      if (card) {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${x - rect.left}px`);
        card.style.setProperty("--my", `${y - rect.top}px`);
      }

      if (!fine || prefersReducedMotion()) return;

      const hero = document.querySelector(".x-hero");
      if (hero) {
        const rect = hero.getBoundingClientRect();
        const inside = y > rect.top && y < rect.bottom;
        hero.style.setProperty("--px", inside ? ((x - rect.left) / rect.width - 0.5).toFixed(3) : "0");
        hero.style.setProperty("--py", inside ? ((y - rect.top) / rect.height - 0.5).toFixed(3) : "0");
      }

      document.querySelectorAll("[data-magnetic]").forEach((el) => {
        const rect = el.getBoundingClientRect();
        const dx = x - (rect.left + rect.width / 2);
        const dy = y - (rect.top + rect.height / 2);
        const near = Math.hypot(dx, dy) < Math.max(rect.width, rect.height) * 0.9;
        el.style.setProperty("--tx", near ? `${(dx * 0.16).toFixed(1)}px` : "0px");
        el.style.setProperty("--ty", near ? `${(dy * 0.22).toFixed(1)}px` : "0px");
      });
    };

    const onMove = (e) => {
      event = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!("IntersectionObserver" in window) || prefersReducedMotion()) return undefined;

    const seen = new WeakSet();
    const timers = new Set();

    // Reveal slightly BEFORE an element scrolls into view (positive bottom margin), so fast scrolling
    // never shows an empty gap. threshold 0 fires as soon as one pixel is inside the extended area.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          io.unobserve(el);
          el.dataset.rv = "in";
          // Hand transitions back to the element's own hover styles once revealed.
          const timer = setTimeout(() => {
            delete el.dataset.rv;
            timers.delete(timer);
          }, 450);
          timers.add(timer);
        }
      },
      { threshold: 0, rootMargin: "0px 0px 35% 0px" }
    );

    const register = (root) => {
      const found = root.matches?.(REVEAL) ? [root, ...root.querySelectorAll(REVEAL)] : root.querySelectorAll?.(REVEAL) || [];
      const lowerEdge = window.innerHeight * 1.35;

      for (const el of found) {
        if (seen.has(el) || el.closest(".hero-x, .auth-modal, .toast-stack")) continue;
        seen.add(el);
        el.dataset.rvDir = el.matches(REVEAL_LEFT) ? "left" : el.matches(REVEAL_RIGHT) ? "right" : el.matches(REVEAL_SCALE) ? "scale" : "up";
        const index = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
        el.style.setProperty("--rv-i", String(Math.min(index, 6)));
        // Anything already on (or just below) the first screen is shown immediately, never hidden first.
        if (el.getBoundingClientRect().top < lowerEdge) continue;
        el.dataset.rv = "out";
        io.observe(el);
      }
    };

    register(document.body);

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) if (node.nodeType === 1) register(node);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);
}
