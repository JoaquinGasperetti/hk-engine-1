// Plantilla base de Survival Horror / Sigilo
HKEngine.registerHooks({
    onInit: function (engine) {
        engine.notify("Usa [C/Cuadrado] para sigilo y [F/Triangulo] para la linterna.", 200);
    },
    onUpdate: function (engine, scene, dtMs, dtScale) {
        // Patrulla simple de demostración para entidades 'enemy'
        for (let i = 0; i < scene.entities.length; i++) {
            const e = scene.entities[i];
            if (e.kind !== "enemy") continue;
            const nextX = e.x + Math.sin(engine.frameTick * 0.02) * 0.03 * dtScale;
            if (HKPhysics.isWalkable(scene.grid, nextX, e.y, 0.22)) e.x = nextX;
        }
    }
});
