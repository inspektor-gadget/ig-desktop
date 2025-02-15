import * as svelte from 'svelte/compiler';
// import * as $ from "svelte/internal/client";

// see https://github.com/sveltejs/svelte/blob/svelte%405.0.0-next.271/sites/svelte-5-preview/src/lib/workers/workers.d.ts

/**
 * Loads a Svelte component from source code,
 * compiles it on the fly, and returns the component.
 *
 * @param {string} source - The raw Svelte component source code.
 * @returns {Promise<any>} - A promise that resolves to the compiled component.
 */
export async function loadAndCompileComponent(source) {
	// Compile the Svelte component source.
	const { js, css } = svelte.compile(source, {
		generate: 'client', // For a DOM app (could be "ssr" for SSR)
		dev: false, // Set to true if you want dev mode warnings
		discloseVersion: false,
		runes: true
	});

	// Optionally, inject the component's CSS into the document.
	if (css && css.code) {
		console.log('css', css);
		// const style = document.createElement("style");
		// style.textContent = css.code;
		// document.head.appendChild(style);
	}

	// Create a Blob from the compiled JavaScript.
	const blob = new Blob([js.code], { type: 'application/javascript' });
	const url = URL.createObjectURL(blob);

	// Dynamically import the module from the Blob URL.
	const module = await import(url);

	// Clean up the Blob URL.
	URL.revokeObjectURL(url);

	// Expect the module to export the Svelte component as its default export.
	return module.default;
}
