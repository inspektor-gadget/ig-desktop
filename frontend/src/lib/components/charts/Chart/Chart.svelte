<script>
    import { onMount, setContext } from "svelte";
    import { writable } from "svelte/store";

    export let dimensions = {};

    let currentDimensions = writable(dimensions)
    $: {
        currentDimensions.set(dimensions)
    }
    setContext("Chart", {
        dimensions: currentDimensions
    });

</script>

<svg class="Chart" width={dimensions.width} height={dimensions.height}>
    <g transform={`translate(${dimensions.marginLeft}, ${dimensions.marginTop})`}>
        <slot />
    </g>
</svg>
