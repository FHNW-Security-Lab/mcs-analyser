import { app } from '/static/js/app.js';

const LINEAGE_CLASS = 'actor-lineage';
const MUTED_CLASS = 'actor-lineage-muted';

function isTerminalActor(node) {
    const value = node.data('terminal_actor');
    return value === true || String(value).toLowerCase() === 'true';
}

function clearActorLineage(cy) {
    cy.elements().removeClass(`${LINEAGE_CLASS} ${MUTED_CLASS}`);
}

function installActorLineage() {
    const cy = app.state.get('cy');
    if (!cy) {
        window.requestAnimationFrame(installActorLineage);
        return;
    }

    cy.style()
        .selector(`.${MUTED_CLASS}`)
        .style({ opacity: 0.1 })
        .selector(`node.${LINEAGE_CLASS}`)
        .style({
            'border-width': 4,
            'border-color': '#e84f8a',
            'z-index': 1200,
        })
        .selector(`edge.${LINEAGE_CLASS}`)
        .style({
            'line-color': '#e84f8a',
            'target-arrow-color': '#e84f8a',
            'width': 5,
            'opacity': 1,
            'z-index': 1190,
        })
        .update();

    cy.on('tap', 'node', (event) => {
        const actor = event.target;
        clearActorLineage(cy);
        if (!isTerminalActor(actor)) return;

        // Cytoscape predecessors() contains every upstream node and every
        // directed edge on a route to the terminal actor.
        const lineage = actor.union(actor.predecessors());
        cy.elements().addClass(MUTED_CLASS);
        lineage.removeClass(MUTED_CLASS).addClass(LINEAGE_CLASS);

        const sensorCount = lineage.nodes().filter((node) => node.data('role') === 'source').length;
        app.ui.showStatus(
            `${actor.data('name')}: ${sensorCount} upstream sensor origin${sensorCount === 1 ? '' : 's'}`,
            'info',
            4000,
        );
    });

    cy.on('tap', (event) => {
        if (event.target === cy) clearActorLineage(cy);
    });
}

document.addEventListener('DOMContentLoaded', installActorLineage);
