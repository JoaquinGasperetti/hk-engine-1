// ============================================================================
// HK Engine 1 — Grid Collision, Raycast LOS & Organic Player Movement
// ============================================================================
const HKPhysics = {
    isBlocked: function (grid, gx, gy) {
        if (!grid || gy < 0 || gy >= grid.length || gx < 0 || gx >= grid[0].length) return true;
        return grid[gy][gx] !== 0;
    },

    isWalkable: function (grid, nx, ny, margin) {
        const m = toF64(margin !== undefined ? margin : 0.24);
        const x = toF64(nx);
        const y = toF64(ny);
        const x0 = (x - m) | 0;
        const x1 = (x + m) | 0;
        const y0 = (y - m) | 0;
        const y1 = (y + m) | 0;
        if (this.isBlocked(grid, x0, y0) || this.isBlocked(grid, x1, y0) ||
            this.isBlocked(grid, x0, y1) || this.isBlocked(grid, x1, y1)) {
            return false;
        }
        return true;
    },

    moveAxis: function (grid, x, y, delta, isX, margin) {
        const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.10));
        const step = delta / steps;
        let cur = isX ? x : y;
        for (let i = 0; i < steps; i++) {
            const next = cur + step;
            if (!this.isWalkable(grid, isX ? next : x, isX ? y : next, margin)) break;
            cur = next;
        }
        return cur;
    },

    hasLineOfSight: function (grid, x0, y0, x1, y1) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, (dist * 3.0) | 0);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            if (this.isBlocked(grid, (x0 + dx * t) | 0, (y0 + dy * t) | 0)) return false;
        }
        return true;
    }
};
