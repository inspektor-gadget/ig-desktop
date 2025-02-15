<script>
    export let id = "";
    export let x1;
    export let x2;
    export let y1;
    export let y2;
    export let colors = [];
</script>

<linearGradient
        {id}
        {x1}
        {x2}
        {y1}
        {y2}
        gradientUnits="userSpaceOnUse"
        spreadMethod="pad">
    {#each colors as color, i}
        <stop
                offset={`${(i * 100) / (colors.length - 1)}%`}
                stop-color={color} />
    {/each}
</linearGradient>
