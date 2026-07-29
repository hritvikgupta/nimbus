import { useEffect } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/**
 * A single hook that drives all GSAP + ScrollTrigger animations on the
 * SplitLanding page. Called once after mount.
 *
 * Because the component uses useLayoutEffect for its own scroll-linked box,
 * we defer to useEffect here so we don't fight layout reads.
 */
export default function useGsapAnimations(mainRef) {
  useEffect(() => {
    // ── Defaults ──
    gsap.defaults({ ease: 'power3.out', duration: 0.8 })

    // ── Hero: stagger entrance on mount ──
    const hero = document.querySelector('section[data-panel] + section')?.previousElementSibling
      ?? document.querySelector('section')
    const heroTitle = hero?.querySelector('h1')
    const heroSub = hero?.querySelector('p')
    const heroExamples = hero?.querySelectorAll('[class*="spl-card"], .spl-card')
    const heroPromptGhost = hero?.querySelector('[class*="heroSlot"]')
    const heroEyebrow = hero?.querySelector('[class*="cloud engineer"]') // the small label

    const heroTimeline = gsap.timeline({ defaults: { ease: 'power3.out', duration: 0.7 } })
    if (heroEyebrow) heroTimeline.from(heroEyebrow, { y: 18, opacity: 0, duration: 0.5 }, 0.1)
    if (heroTitle) heroTimeline.from(heroTitle, { y: 30, opacity: 0 }, 0.25)
    if (heroSub) heroTimeline.from(heroSub, { y: 24, opacity: 0 }, 0.45)
    if (heroPromptGhost) heroTimeline.from(heroPromptGhost, { y: 20, opacity: 0, scale: 0.97 }, 0.6)
    if (heroExamples?.length) {
      heroTimeline.from(heroExamples, { y: 20, opacity: 0, stagger: 0.08 }, 0.8)
    }

    // ── Scroll-triggered panel reveals ──
    const panels = mainRef?.current?.querySelectorAll('[data-panel]')
    if (panels?.length) {
      panels.forEach((panel) => {
        const eyebrow = panel.querySelector('[class*="eyebrow"]') ?? panel.querySelector('span ~ h2')?.previousElementSibling
        const heading = panel.querySelector('h2')
        const lead = heading?.nextElementSibling?.tagName === 'P' ? heading.nextElementSibling : null

        // Collect all "content" children after the lead paragraph for staggered reveal
        const contentEls = []
        if (lead) {
          let sibling = lead.nextElementSibling
          while (sibling && sibling.tagName !== 'SECTION' && !sibling.hasAttribute('data-panel')) {
            if (sibling.tagName !== 'STYLE') contentEls.push(sibling)
            sibling = sibling.nextElementSibling
          }
        }

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: panel,
            start: 'top 82%',
            toggleActions: 'play none none none',
          },
        })

        if (eyebrow) tl.from(eyebrow, { y: 18, opacity: 0, duration: 0.5 }, 0)
        if (heading) tl.from(heading, { y: 24, opacity: 0 }, 0.15)
        if (lead) tl.from(lead, { y: 18, opacity: 0 }, 0.3)
        if (contentEls.length) {
          tl.from(contentEls, { y: 30, opacity: 0, stagger: 0.08 }, 0.45)
        }
      })
    }

    // ── Hub-and-spoke: animate left→right clouds and actions ──
    const hubSpoke = document.querySelector('[data-gsap="hubspoke"]')
    if (hubSpoke) {
      const leftItems = hubSpoke.querySelectorAll('[class*="leftItem"]')
      const rightItems = hubSpoke.querySelectorAll('[class*="rightItem"]')
      const centerLogo = hubSpoke.querySelector('circle + g, [class*="Nimbus"]')
      if (leftItems.length || rightItems.length) {
        gsap.from(leftItems, {
          scrollTrigger: { trigger: hubSpoke, start: 'top 80%' },
          x: -30, opacity: 0, stagger: 0.12, duration: 0.6, ease: 'power2.out',
        })
        gsap.from(rightItems, {
          scrollTrigger: { trigger: hubSpoke, start: 'top 80%' },
          x: 30, opacity: 0, stagger: 0.12, duration: 0.6, ease: 'power2.out',
        })
      }
    }

    // ── Design canvas: stagger nodes ──
    const canvas = document.querySelector('[data-gsap="canvas"]')
    if (canvas) {
      const nodes = canvas.querySelectorAll('[class*="CanvasNode"]')
      if (nodes.length) {
        gsap.from(nodes, {
          scrollTrigger: { trigger: canvas, start: 'top 80%' },
          y: 20, opacity: 0, scale: 0.92, stagger: 0.1, duration: 0.5, ease: 'back.out(1.4)',
        })
      }
    }

    // ── Cost bars: animate widths ──
    const costSection = document.querySelector('[data-gsap="cost"]')
    if (costSection) {
      const bars = costSection.querySelectorAll('[class*="costBar"]')
      if (bars.length) {
        bars.forEach((bar) => {
          const w = bar.getAttribute('data-width') || '0'
          bar.style.width = '0%'
          gsap.to(bar, {
            scrollTrigger: { trigger: costSection, start: 'top 80%' },
            width: `${w}%`, duration: 0.8, ease: 'power3.out',
          })
        })
      }
    }

    // ── Sessions board: stagger cards ──
    const sessions = document.querySelector('[data-gsap="sessions"]')
    if (sessions) {
      const cards = sessions.querySelectorAll('[class*="spl-card"]')
      if (cards.length) {
        gsap.from(cards, {
          scrollTrigger: { trigger: sessions, start: 'top 82%' },
          y: 20, opacity: 0, stagger: 0.06, duration: 0.5, ease: 'power2.out',
        })
      }
    }

    // ── Terminal session: typewriter-style reveal ──
    const terminal = document.querySelector('[data-gsap="terminal"]')
    if (terminal) {
      gsap.from(terminal, {
        scrollTrigger: { trigger: terminal, start: 'top 80%' },
        y: 20, opacity: 0, duration: 0.6, ease: 'power2.out',
      })
    }

    // ── Sandbox diagram ──
    const sandbox = document.querySelector('[data-gsap="sandbox"]')
    if (sandbox) {
      gsap.from(sandbox.children, {
        scrollTrigger: { trigger: sandbox, start: 'top 82%' },
        y: 16, opacity: 0, stagger: 0.07, duration: 0.5, ease: 'power2.out',
      })
    }

    // ── Runtime cards (connect a machine) ──
    const runtimeGrid = document.querySelector('[data-gsap="runtimes"]')
    if (runtimeGrid) {
      const cards = runtimeGrid.children
      if (cards.length) {
        gsap.from(cards, {
          scrollTrigger: { trigger: runtimeGrid, start: 'top 82%' },
          y: 24, opacity: 0, stagger: 0.1, duration: 0.5, ease: 'power2.out',
        })
      }
    }

    // ── Workflow YAML ──
    const workflow = document.querySelector('[data-gsap="workflow"]')
    if (workflow) {
      gsap.from(workflow, {
        scrollTrigger: { trigger: workflow, start: 'top 82%' },
        y: 20, opacity: 0, duration: 0.6, ease: 'power2.out',
      })
    }

    // Refresh ScrollTrigger after fonts / images settle
    ScrollTrigger.refresh()
    const t = setTimeout(() => ScrollTrigger.refresh(), 600)
    return () => { clearTimeout(t); ScrollTrigger.getAll().forEach((st) => st.kill()) }
  }, [mainRef])
}