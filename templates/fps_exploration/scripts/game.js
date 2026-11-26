// Script de ejemplo para plantilla FPS / Exploración en HK Engine 1
HKEngine.registerHooks({
    onInit: function (engine, scene) {
        engine.notify("Explora el nivel y activa el interruptor central.", 180);
    },
    onInteract: function (engine, scene, entity) {
        if (entity.kind === "switch") {
            entity.taken = true;
            for (let y = 0; y < scene.grid.length; y++) {
                for (let x = 0; x < scene.grid[y].length; x++) {
                    if (scene.grid[y][x] === 5) scene.grid[y][x] = 0;
                }
            }
            engine.notify("Interruptor activado: compuertas abiertas.", 180);
        } else if (entity.kind === "item") {
            entity.taken = true;
            scene.player.items++;
            engine.notify("Objeto obtenido: " + entity.label, 140);
        } else if (entity.kind === "npc") {
            engine.notify(entity.dialog, 210);
        }
    }
});
