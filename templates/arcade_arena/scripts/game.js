// Plantilla base de Arcade Contrarreloj 3D
HKEngine.registerHooks({
    onInit: function (engine) {
        engine.notify("Recoge todos los orbes lo mas rapido posible!", 180);
    },
    onInteract: function (engine, scene, entity) {
        if (entity.kind === "item") {
            entity.taken = true;
            scene.player.items++;
            scene.player.score += 100;
            engine.notify("Puntuacion: " + scene.player.score, 120);
        }
    }
});
