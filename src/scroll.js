// Scrolling helpers: instant for short moves (e.g. j/k) and huge jumps, smooth in between

// Beyond this many screens an animation would just be a blur, so jump instantly
const MAX_SMOOTH_SCREENS = 5;

// Scroll `container` to `top`, animating only jumps between 1 and MAX_SMOOTH_SCREENS screens
export function scrollContainerTo(container, top) {
    const target = Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight));
    const distance = Math.abs(target - container.scrollTop);
    if (distance < 1) return;
    const screen = container.clientHeight;
    const smooth = distance > screen && distance <= screen * MAX_SMOOTH_SCREENS;
    container.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
}

// Scroll so a row spanning [rowTop, rowTop + rowHeight) (in container content coordinates)
// is visible. `block` follows scrollIntoView: 'nearest' | 'center' | 'start' | 'end'.
export function scrollRowIntoView(container, rowTop, rowHeight, block = 'nearest') {
    const viewTop = container.scrollTop;
    const viewHeight = container.clientHeight;
    let target;
    switch (block) {
        case 'center': target = rowTop - (viewHeight - rowHeight) / 2; break;
        case 'start': target = rowTop; break;
        case 'end': target = rowTop + rowHeight - viewHeight; break;
        default:
            if (rowTop < viewTop) target = rowTop;
            else if (rowTop + rowHeight > viewTop + viewHeight) target = rowTop + rowHeight - viewHeight;
            else return;
    }
    scrollContainerTo(container, target);
}

// Same as scrollRowIntoView, for an element rendered inside `container`
export function scrollElementIntoView(element, container, block = 'nearest') {
    if (!element || !container) return;
    const rowTop = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    scrollRowIntoView(container, rowTop, element.offsetHeight, block);
}
