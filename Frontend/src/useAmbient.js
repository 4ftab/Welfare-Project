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

// Surfaces that carry perpetual decorative animation. They are paused (via [data-offscreen]) while off screen.
const AMBIENT = ".x-hero, .ticker, .x-cta-band, .x-footer, .x-donate, .x-btn-gold";
const MAGNETIC = "[data-magnetic]";
const ALL = `${REVEAL},${AMBIENT},${MAGNETIC}`;

const canHover = () => window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Static hints that the device cannot afford the richer ambient effects. */
function looksLowPower() {
  const nav = navigator;
  return Boolean(
    (nav.deviceMemory && nav.deviceMemory <= 2) ||
      (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) ||
      nav.connection?.saveData
  );
}

/**
 * Measures real frame pacing shortly after load. A device that cannot hold ~36fps while idle gets the
 * lite effects profile (html[data-perf="lite"]), regardless of its screen size.
 */
function watchFramePacing(root) {
  let frame = 0;
  let cancelled = false;

  const timer = window.setTimeout(() => {
    const deltas = [];
    let last = 0;
    const sample = (now) => {
      if (cancelled || document.visibilityState !== "visible") return; // throttled tab: can't judge
      if (last) deltas.push(now - last);
      last = now;
      if (deltas.length < 60) {
        frame = requestAnimationFrame(sample);
        return;
      }
      deltas.sort((a, b) => a - b);
      if (deltas[deltas.length >> 1] > 28) root.dataset.perf = "lite";
    };
    frame = requestAnimationFrame(sample);
  }, 2500);

  return () => {
    cancelled = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  };
}

/**
 * Page-wide ambient behaviours, all progressive enhancement. One effect owns every listener and observer so
 * nothing is duplicated and cleanup is in one place:
 *  - scroll progress bar + condensed navbar (one passive, rAF-throttled scroll listener, no layout reads)
 *  - cursor spotlight on cards, pointer parallax in the hero, magnetic buttons (only for on-screen targets)
 *  - staggered reveal-on-scroll (IntersectionObserver; content is plain visible if it, or JS, is unavailable)
 *  - pausing perpetual decorative animation while its surface is off screen
 */
export function useAmbient() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = prefersReducedMotion();
    const fine = canHover();

    if (looksLowPower()) root.dataset.perf = "lite";
    const stopPacing = reduced ? () => {} : watchFramePacing(root);

    /* ───────── scroll: progress bar + condensed nav ───────── */

    const bar = document.getElementById("scroll-progress");
    let nav = null;
    let maxScroll = 0;
    let scrolled = false;
    let lastScale = -1;
    let scrollFrame = 0;

    const measure = () => {
      maxScroll = root.scrollHeight - window.innerHeight;
    };

    const paintScroll = () => {
      scrollFrame = 0;
      const y = window.scrollY;
      const scale = maxScroll > 0 ? Math.min(1, y / maxScroll) : 0;
      if (bar && Math.abs(scale - lastScale) > 0.0005) {
        lastScale = scale;
        bar.style.transform = `scaleX(${scale})`;
      }
      const now = y > 24;
      if (now !== scrolled) {
        scrolled = now;
        if (!nav?.isConnected) nav = document.querySelector(".x-nav");
        nav?.toggleAttribute("data-scrolled", now);
      }
    };

    const onScroll = () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(paintScroll);
    };

    const onResize = () => {
      measure();
      onScroll();
    };

    measure();
    paintScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    // Page height changes when content mounts or loads; re-measure then, never during scroll.
    const sizeObserver = "ResizeObserver" in window ? new ResizeObserver(onResize) : null;
    sizeObserver?.observe(document.body);

    /* ───────── shared visibility bookkeeping ───────── */

    const visibleHero = new Set();
    const visibleMagnetic = new Set();

    // One observer decides whether ambient / magnetic surfaces are on screen.
    const visibility = new IntersectionObserver(
      (entries) => {
        for (const { target: el, isIntersecting } of entries) {
          if (el.matches(AMBIENT)) el.toggleAttribute("data-offscreen", !isIntersecting);
          if (el.matches(".x-hero")) {
            if (isIntersecting) visibleHero.add(el);
            else visibleHero.delete(el);
          }
          if (el.matches(MAGNETIC)) {
            if (isIntersecting) visibleMagnetic.add(el);
            else visibleMagnetic.delete(el);
          }
        }
      },
      { rootMargin: "80px 0px" }
    );

    /* ───────── pointer: spotlight, hero parallax, magnetic buttons ───────── */

    let pointerFrame = 0;
    let pointer = null;

    const applyPointer = () => {
      pointerFrame = 0;
      const { clientX: x, clientY: y, target } = pointer;

      const card = target.closest?.(".panel, .stat-card, .value, .impact-strip article");
      if (card) {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${x - rect.left}px`);
        card.style.setProperty("--my", `${y - rect.top}px`);
      }

      if (!fine || reduced || root.dataset.perf === "lite") return;

      for (const hero of visibleHero) {
        const rect = hero.getBoundingClientRect();
        const inside = y > rect.top && y < rect.bottom;
        const px = inside ? ((x - rect.left) / rect.width - 0.5).toFixed(2) : "0";
        const py = inside ? ((y - rect.top) / rect.height - 0.5).toFixed(2) : "0";
        if (hero.style.getPropertyValue("--px") !== px) hero.style.setProperty("--px", px);
        if (hero.style.getPropertyValue("--py") !== py) hero.style.setProperty("--py", py);
      }

      for (const el of visibleMagnetic) {
        const rect = el.getBoundingClientRect();
        const dx = x - (rect.left + rect.width / 2);
        const dy = y - (rect.top + rect.height / 2);
        const near = Math.hypot(dx, dy) < Math.max(rect.width, rect.height) * 0.9;
        el.style.setProperty("--tx", near ? `${(dx * 0.16).toFixed(1)}px` : "0px");
        el.style.setProperty("--ty", near ? `${(dy * 0.22).toFixed(1)}px` : "0px");
      }
    };

    const onMove = (e) => {
      pointer = e;
      if (!pointerFrame) pointerFrame = requestAnimationFrame(applyPointer);
    };

    window.addEventListener("pointermove", onMove, { passive: true });

    /* ───────── reveal on scroll ───────── */

    const seen = new WeakSet();
    let reveal = null;

    if (!reduced && "IntersectionObserver" in window) {
      // Reveal slightly BEFORE an element scrolls into view, so fast scrolling never shows an empty gap.
      reveal = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            reveal.unobserve(entry.target);
            entry.target.dataset.rv = "in";
          }
        },
        { threshold: 0, rootMargin: "0px 0px 35% 0px" }
      );
    }

    // Hand transitions back to an element's own hover styles once its reveal finishes (no per-element timers).
    const onTransitionEnd = (e) => {
      const el = e.target;
      if (el.dataset?.rv === "in" && e.propertyName === "transform") delete el.dataset.rv;
    };
    document.addEventListener("transitionend", onTransitionEnd);

    const register = (nodes) => {
      const found = new Set();
      for (const node of nodes) {
        if (!node.isConnected) continue;
        if (node.matches(ALL)) found.add(node);
        node.querySelectorAll(ALL).forEach((el) => found.add(el));
      }

      const fresh = [...found].filter((el) => !seen.has(el));
      if (!fresh.length) return;

      // Read phase first: measure everything before writing anything (no forced reflow per element).
      const lowerEdge = window.innerHeight * 1.35;
      const tops = fresh.map((el) => el.getBoundingClientRect().top);

      // Write phase.
      fresh.forEach((el, i) => {
        seen.add(el);
        if (el.matches(AMBIENT) || el.matches(MAGNETIC)) visibility.observe(el);
        if (!reveal || !el.matches(REVEAL) || el.closest(".hero-x, .auth-modal, .toast-stack")) return;

        el.dataset.rvDir = el.matches(REVEAL_LEFT) ? "left" : el.matches(REVEAL_RIGHT) ? "right" : el.matches(REVEAL_SCALE) ? "scale" : "up";
        const index = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
        el.style.setProperty("--rv-i", String(Math.min(index, 6)));
        // Anything already on (or just below) the first screen is shown immediately, never hidden first.
        if (tops[i] < lowerEdge) return;
        el.dataset.rv = "out";
        reveal.observe(el);
      });
    };

    // Coalesce DOM mutations (a route change adds hundreds of nodes) into one scan per frame.
    let pending = [];
    let scanFrame = 0;
    const flush = () => {
      scanFrame = 0;
      const nodes = pending;
      pending = [];
      register(nodes);
    };

    const host = document.getElementById("root") || document.body;
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node.nodeType === 1) pending.push(node);
      }
      if (pending.length && !scanFrame) scanFrame = requestAnimationFrame(flush);
    });
    mutations.observe(host, { childList: true, subtree: true });

    register([host]);

    return () => {
      stopPacing();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("transitionend", onTransitionEnd);
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(pointerFrame);
      cancelAnimationFrame(scanFrame);
      sizeObserver?.disconnect();
      mutations.disconnect();
      visibility.disconnect();
      reveal?.disconnect();
    };
  }, []);
}
