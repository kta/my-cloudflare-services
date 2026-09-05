/** 画面上の「押せそうな要素」と「実際に押せる要素」を洗い出す */
export async function probeClickables(page) {
  return page.evaluate(() => {
    const out = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      const tag = el.tagName.toLowerCase()
      const role = el.getAttribute('role')
      const native = ['button', 'a', 'input', 'select', 'textarea', 'summary'].includes(tag)
      const roleI = [
        'button',
        'link',
        'tab',
        'menuitem',
        'option',
        'checkbox',
        'radio',
        'switch',
      ].includes(role || '')
      const pointer = cs.cursor === 'pointer'
      if (!(pointer || native || roleI || el.hasAttribute('tabindex'))) continue
      out.push({
        tag,
        role,
        pointer,
        native,
        roleI,
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        testid: el.getAttribute('data-testid'),
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: (el.innerText || el.getAttribute('aria-label') || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 60),
      })
    }
    return out
  })
}

export async function smallTargets(page) {
  const list = await probeClickables(page)
  return list.filter((e) => (e.native || e.roleI) && (e.w < 44 || e.h < 44))
}

export async function motionAudit(page) {
  return page.evaluate(() => {
    let transition = 0,
      animation = 0
    const samples = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el)
      if (cs.transitionDuration && cs.transitionDuration !== '0s') {
        transition++
        if (samples.length < 8)
          samples.push({ t: el.tagName.toLowerCase(), d: cs.transitionDuration })
      }
      if (cs.animationName && cs.animationName !== 'none') animation++
    }
    return { transition, animation, total: document.querySelectorAll('body *').length, samples }
  })
}

/** 画面外にはみ出している要素 */
export async function overflowAudit(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth,
      vh = window.innerHeight
    let offRight = 0,
      offBottom = 0
    const samples = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      if (r.right > vw + 1) {
        offRight++
        if (samples.length < 8)
          samples.push({ t: el.innerText?.trim().slice(0, 24), right: Math.round(r.right) })
      }
      if (r.bottom > vh + 1) offBottom++
    }
    return {
      vw,
      vh,
      offRight,
      offBottom,
      samples,
      canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      canScrollY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }
  })
}

/** ランドマーク・見出し構造 */
export async function landmarkAudit(page) {
  return page.evaluate(() => ({
    main: document.querySelectorAll('main').length,
    h1: Array.from(document.querySelectorAll('h1'))
      .map((e) => e.innerText.trim())
      .slice(0, 3),
    headings: document.querySelectorAll('h1,h2,h3').length,
    title: document.title,
    url: location.href,
  }))
}
