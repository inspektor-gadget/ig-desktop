<script lang="ts">
	// @ts-nocheck
	import * as d3 from 'd3';

	let { data } = $props();

	/** @type {ResizeObserver | undefined} */
	let observer;
	/** @type {WeakMap<Element, (element: Element) => void> | undefined} */
	let callbacks;

	// from: https://github.com/sveltejs/svelte/issues/7583
	/**
	 * @param {Element} element
	 * @param {(element: Element) => void} onResize
	 */
	export function resizeObserver(element, onResize) {
		if (!observer) {
			callbacks = new WeakMap();
			observer = new ResizeObserver((entries) => {
				for (const entry of entries) {
					const onResize = callbacks?.get(entry.target);
					if (onResize) onResize(entry.target);
				}
			});
		}

		callbacks?.set(element, onResize);
		observer.observe(element);

		return {
			destroy: () => {
				callbacks?.delete(element);
				observer?.unobserve(element);
			}
		};
	}

	class TimeSeriesChart {
		/**
		 * @param {Object} [options]
		 * @param {any} [options.data]
		 * @param {number} [options.width]
		 * @param {number} [options.height]
		 * @param {string} [options.title]
		 * @param {number} [options.yMin]
		 * @param {number} [options.yMax]
		 * @param {string | Function} [options.format]
		 * @param {any[]} [options.legendValues]
		 * @param {string} [options.rightFooter]
		 * @param {Function} [options.selectionHandler]
		 * @param {any[]} [options.series]
		 * @param {number} [options.xField]
		 */
		constructor({
			data,
			width = 500,
			height = 196,
			title,
			yMin,
			yMax,
			format = '.4~s',
			legendValues = [],
			rightFooter,
			selectionHandler,
			series = [],
			xField = 0
		} = {}) {
			this._data = data;
			this._width = width;
			this._height = height;
			this._title = title;
			this._yMin = yMin;
			this._yMax = yMax;
			this._format = format;
			this._legendValues = legendValues;
			this._rightFooter = rightFooter;
			this._selectionHandler = selectionHandler;
			this._series = series;
			this._xField = xField;
		}

		get svg() {
			if (this._svg === undefined) {
				this._render();
			}
			return this._svg.node();
		}

		get data() {
			return this._data;
		}

		set data(data) {
			this.refreshData(data);
		}

		appendTo(selector) {
			d3.select(selector).selectChildren().remove();
			d3.select(selector).append(() => this.svg);
		}

		refreshData(data) {
			this._data = data;

			if (this._svg === undefined) {
				return;
			}

			const transitionDuration = 400;

			const [yDomain, legendEntries] = this._prepare(data);

			this._xScale.domain(d3.extent(data, (d) => d[this._xField]));
			this._yScale.domain(yDomain).nice();

			this._svg
				.select('.x-axis')
				.transition()
				.duration(transitionDuration)
				.ease(d3.easeExp)
				.call(this._xAxis(this._xScale));

			this._svg
				.select('.y-axis')
				.transition()
				.duration(transitionDuration)
				.ease(d3.easeExp)
				.call(this._yAxis(this._yScale));

			const pathFn = this._pathFn;

			this._svg.selectAll('.path').each(function () {
				d3.select(this).attr('d', pathFn[this.dataset.fn](data));
				// d3.select(this)
				//     .transition()
				//     .duration(transitionDuration/2)
				//     .ease(d3.easeLinear)
				//     .attr("opacity", 0.0)
				//     .on("end", function () {
				//         d3.select(this)
				//             .attr("d", pathFn[this.dataset.fn](data))
				//             .transition()
				//             .duration(transitionDuration/2)
				//             .ease(d3.easeExp)
				//             .attr("opacity", 1.0);
				//     });
			});

			this._svg
				.selectAll('.legend-text')
				.data(legendEntries)
				.text((d) => d.text);
		}

		_render() {
			// Environment, formatters, helpers
			const margin = { top: 12, right: 12, bottom: 18, left: 50 };
			const legendFontSize = 11;
			const formatAsDate = d3.timeFormat('%-m/%-d');
			const formatAsTime = d3.timeFormat('%-Hh%M');
			const formatAsDateTime = d3.timeFormat('%Y-%m-%d %H:%M:%S');
			const xTickFormatter = (d) =>
				d.getHours() === 0 && d.getMinutes() === 0 ? formatAsDate(d) : formatAsTime(d);
			const yTickFormatter =
				typeof this._format === 'function' ? this._format('axis') : d3.format(this._format);
			const yValueFormatter =
				typeof this._format === 'function' ? this._format('value') : d3.format(this._format);

			const boundaries = {
				left: margin.left,
				right: this._width - margin.right,
				top: margin.top,
				bottom: this._height - margin.bottom
			};

			const axisStyler = (g) => {
				g.selectAll('line')
					.attr('stroke', 'lightgrey')
					.attr('stroke-opacity', 0.7)
					.attr('shape-rendering', 'geometricPrecision');
				if (g.node().classList.contains('y-axis')) {
					g.select('.domain').attr('opacity', 0.0);
				} else {
					g.select('.domain').attr('stroke', 'grey');
				}
			};

			// Calculate y axis domain and prepare legendentries if needed
			const [yDomain, legendEntries] = this._prepare(this._data);

			const footerRows =
				legendEntries.length === 0 && this._rightFooter !== undefined ? 1 : legendEntries.length;

			// Start building the svg
			const svg = d3
				.create('svg')
				.attr('width', this._width)
				.attr('height', this._height + footerRows * (legendFontSize + 3));

			const xScale = d3
				.scaleTime()
				.domain(d3.extent(this._data, (d) => d[this._xField]))
				.range([boundaries.left, boundaries.right]);

			const xAxis = (scale) => {
				return (g) =>
					g
						.attr('class', 'x-axis')
						.attr('transform', `translate(0, ${boundaries.bottom})`)
						.call(
							d3
								.axisBottom(scale)
								.ticks(8)
								.tickPadding(8)
								.tickSizeInner(boundaries.top - boundaries.bottom)
								.tickSizeOuter(0)
								.tickFormat(xTickFormatter)
						)
						.call(axisStyler);
			};

			const yScale = d3
				.scaleLinear()
				.domain(yDomain)
				.range([boundaries.bottom, boundaries.top])
				.nice();

			const yAxis = (scale) => {
				return (g) =>
					g
						.attr('class', 'y-axis')
						.attr('transform', `translate(${boundaries.left}, 0)`)
						.call(
							d3
								.axisLeft(scale)
								.ticks(5)
								.tickPadding(8)
								.tickSizeInner(boundaries.left - boundaries.right)
								.tickSizeOuter(0)
								.tickFormat(yTickFormatter)
						)
						.call(axisStyler);
			};

			svg.append('g').call(yAxis(yScale));
			svg.append('g').call(xAxis(xScale));

			// A unique identifier is required for the clip-path element (no success finding
			// an alternative with <basic-shape> and <geometry-box> under Chrome).
			// -> Basic helper to prevent things to break if multiple components
			// are generated on the same page. In observable, consider using DOM.uid() instead.
			if (!window.hasOwnProperty('TimeSeriesChartCounter')) {
				window.TimeSeriesChartCounter = 0;
			}
			const clipId = `timeserieschart-clip-${++window.TimeSeriesChartCounter}`;

			svg
				.append('defs')
				.append('clipPath')
				.attr('id', clipId)
				.append('rect')
				.attr('x', boundaries.left)
				.attr('y', boundaries.top - 1)
				.attr('width', boundaries.right - boundaries.left)
				.attr('height', boundaries.bottom - boundaries.top + 2);

			let pathCnt = 0;
			const pathFn = {};
			const tooltipMetrics = [];

			for (const [i, s] of this._series.entries()) {
				const yPrepared =
					s.hasOwnProperty('negativeY') && s.negativeY
						? (d) => yScale(-d[s.metric])
						: (d) => yScale(d[s.metric]);

				if (s.hasOwnProperty('lineColor')) {
					pathCnt++;

					const line = d3
						.line()
						.defined((d) => d[s.metric] !== null)
						.x((d) => xScale(d[this._xField]))
						.y(yPrepared);

					svg
						.append('path')
						.datum(this._data)
						.attr('data-fn', `path-${pathCnt}`)
						.attr('class', 'path')
						.attr('clip-path', `url(#${clipId})`)
						.attr('stroke', s.lineColor)
						.attr('fill', 'none')
						.attr('stroke-width', 1.0)
						.attr('opacity', 1.0)
						.attr('d', line)
						.style('-webkit-clip-path', `url(#${clipId})`);

					pathFn[`path-${pathCnt}`] = line;
				}

				if (s.hasOwnProperty('fillColor')) {
					let baseline;
					let defined;

					pathCnt++;

					if (s.hasOwnProperty('fillToMetric') && s.fillToMetric) {
						baseline =
							s.hasOwnProperty('negativeY') && s.negativeY
								? (d) => yScale(-d[s.fillToMetric])
								: (d) => yScale(d[s.fillToMetric]);
						defined = (d) => d[s.metric] !== null && d[s.metric] >= d[s.fillToMetric];
					} else if (s.hasOwnProperty('fillToZero') && s.fillToZero) {
						baseline = (d) => yScale(0);
						defined = (d) => d[s.metric] !== null && d[s.metric] >= 0;
					} else {
						baseline =
							s.hasOwnProperty('negativeY') && s.negativeY
								? (d) => yScale(yScale.domain()[1])
								: (d) => yScale(yScale.domain()[0]);
						defined = (d) => d[s.metric] !== null;
					}

					const [y0, y1] =
						s.hasOwnProperty('negativeY') && s.negativeY
							? [yPrepared, baseline]
							: [baseline, yPrepared];

					const area = d3
						.area()
						.defined(defined)
						.x((d) => xScale(d[this._xField]))
						.y0(y0)
						.y1(y1);

					svg
						.append('path')
						.datum(this._data)
						.attr('data-fn', `path-${pathCnt}`)
						.attr('class', 'path')
						.attr('clip-path', `url(#${clipId})`)
						.attr('stroke', 'none')
						.attr('fill', s.fillColor)
						.attr('opacity', 1.0)
						.attr('d', area)
						.style('-webkit-clip-path', `url(#${clipId})`);

					pathFn[`path-${pathCnt}`] = area;
				}

				if (s.hasOwnProperty('tooltip') && s.tooltip) {
					tooltipMetrics.push({ metric: s.metric, label: s.label });
				}
			}

			if (this._selectionHandler !== undefined || tooltipMetrics.length > 0) {
				const context = d3.create('svg:g');
				let brush;

				if (this._selectionHandler !== undefined) {
					brush = d3
						.brushX()
						.extent([
							[boundaries.left, boundaries.top],
							[boundaries.right, boundaries.bottom]
						])
						.on('start end', ({ target, type, selection }) => {
							svg.selectAll('.interactive').style('display', 'none');
							if (type === 'end' && selection !== null) {
								this._selectionHandler(this, ...selection.map(xScale.invert));
								svg.select('.brush').call(target.move, null);
							}
						});

					context.attr('class', 'brush');
					context.call(brush);
					svg.attr('cursor', 'crosshair');
				} else {
					context
						.append('rect')
						.attr('x', boundaries.left)
						.attr('y', boundaries.top)
						.attr('width', boundaries.right - boundaries.left)
						.attr('height', boundaries.bottom - boundaries.top)
						.attr('fill', 'none')
						.attr('pointer-events', 'all');
				}

				if (tooltipMetrics.length > 0) {
					const tooltipHeight = 20 + tooltipMetrics.length * (legendFontSize + 3);

					const tooltip = d3
						.create('svg:g')
						.attr('class', 'interactive')
						.attr('font-family', 'monospace')
						.attr('font-size', legendFontSize + 'px')
						.attr('font-weight', 'normal')
						.attr('fill', 'black')
						.attr('stroke', 'none')
						.attr('opacity', 0.8)
						.style('display', 'none');

					tooltip
						.append('rect')
						.attr('x', 0)
						.attr('y', 0)
						.attr('width', 140)
						.attr('height', tooltipHeight)
						.attr('fill', 'white')
						.attr('stroke', 'black')
						.attr('stroke-opacity', 0.5)
						.attr('shape-rendering', 'crispEdges');

					tooltip
						.append('text')
						.attr('class', 'tooltip-x-value')
						.attr('x', 70)
						.attr('y', 12)
						.attr('text-anchor', 'middle');

					let offset = 25;

					for (const v of tooltipMetrics) {
						tooltip
							.append('text')
							.attr('x', 10)
							.attr('y', offset)
							.attr('text-anchor', 'start')
							.text(v.label);

						tooltip
							.append('text')
							.attr('class', 'tooltip-y-value')
							.attr('x', 130)
							.attr('y', offset)
							.attr('text-anchor', 'end');

						offset += legendFontSize + 3;
					}

					const focus = svg
						.append('line')
						.attr('class', 'interactive')
						.attr('x1', 0)
						.attr('x2', 0)
						.attr('y1', boundaries.top)
						.attr('y2', boundaries.bottom)
						.attr('stroke', 'red')
						.attr('opacity', 0.5)
						.style('display', 'none');

					const bisect = d3.bisector((d) => d[this._xField]).left;
					const flipCoordinates = [boundaries.right - 155, boundaries.bottom - tooltipHeight - 10];

					const mouseMoved = ({ offsetX: x, offsetY: y }) => {
						if (
							x < boundaries.left ||
							x > boundaries.right ||
							y < boundaries.top ||
							y > boundaries.bottom
						) {
							return;
						}

						if (focus.style('display') !== 'block') {
							focus.style('display', 'block');
						}

						if (tooltip.style('display') !== 'block') {
							tooltip.style('display', 'block');
						}

						const date = xScale.invert(x);
						const index = bisect(this._data, date, 1);
						const row =
							date - this._data[index - 1][this._xField] > this._data[index][this._xField] - date
								? this._data[index]
								: this._data[index - 1];
						const focusX = xScale(row[this._xField]);
						const tooltipX = focusX < flipCoordinates[0] ? focusX + 15 : focusX - 155;
						const tooltipY = y < flipCoordinates[1] ? y + 10 : y - tooltipHeight - 10;

						focus.attr('transform', `translate(${focusX}, 0)`);
						tooltip.attr('transform', `translate(${tooltipX}, ${tooltipY})`);
						tooltip.select('.tooltip-x-value').text(formatAsDateTime(row[this._xField]));
						tooltip
							.selectAll('.tooltip-y-value')
							.data(tooltipMetrics)
							.text((d) => (row[d.metric] !== null ? yValueFormatter(row[d.metric]) : 'n/a'));
					};

					if (brush !== undefined) {
						brush.on('brush', ({ sourceEvent }) => {
							if (sourceEvent !== undefined && sourceEvent.type === 'mousemove') {
								mouseMoved(sourceEvent);
							}
						});
					}

					context
						.on('touchend mouseleave', () => {
							svg.selectAll('.interactive').style('display', 'none');
						})
						.on('touchmove mousemove', mouseMoved);

					svg.append((d) => context.node());
					svg.append((d) => tooltip.node());
				} else {
					svg.append((d) => context.node());
				}
			}

			if (footerRows > 0) {
				const footer = svg
					.append('g')
					.attr('transform', `translate(0, ${this._height})`)
					.attr('font-family', 'monospace')
					.attr('font-size', legendFontSize + 'px')
					.attr('font-weight', 'normal');

				let offset = (legendFontSize + 3) / 2;

				if (this._rightFooter !== undefined) {
					footer
						.append('text')
						.attr('x', boundaries.right - 5)
						.attr('y', offset)
						.attr('text-anchor', 'end')
						.attr('dominant-baseline', 'middle')
						.style('white-space', 'pre')
						.text(this._rightFooter);
				}

				for (const v of legendEntries) {
					footer
						.append('rect')
						.attr('width', 12)
						.attr('height', 4)
						.attr('x', margin.left / 2 + 4)
						.attr('y', offset - 2)
						.attr('rx', 2)
						.attr('ry', 2)
						.attr('fill', v.color);

					footer
						.append('text')
						.attr('class', 'legend-text')
						.attr('x', margin.left / 2 + 20)
						.attr('y', offset)
						.attr('dominant-baseline', 'middle')
						.style('white-space', 'pre')
						.text(v.text);

					offset += legendFontSize + 3;
				}
			}

			if (this._title !== undefined) {
				svg
					.append('text')
					.attr('x', this._width / 2)
					.attr('y', margin.top / 2)
					.attr('font-family', 'sans-serif')
					.attr('font-size', '12px')
					.attr('font-weight', 'bold')
					.attr('text-anchor', 'middle')
					.text(this._title);
			}

			this._xScale = xScale;
			this._yScale = yScale;
			this._xAxis = xAxis;
			this._yAxis = yAxis;
			this._pathFn = pathFn;
			this._svg = svg;
		}

		_prepare(data) {
			const yDomain = [
				this._yMin !== undefined ? this._yMin : Infinity,
				this._yMax !== undefined ? this._yMax : -Infinity
			];

			const yValueFormatter =
				typeof this._format === 'function' ? this._format('value') : d3.format(this._format);
			const formatter = (v) =>
				v !== null && v !== undefined ? yValueFormatter(v).padEnd(9, ' ') : 'n/a      ';

			const legendValues = [
				...new Set(this._legendValues.filter((v) => ['Min', 'Max', 'Avg', 'Last'].includes(v)))
			];

			const legendEntries = [];

			for (const s of this._series) {
				const aggs = {};

				if (s.hasOwnProperty('legend') && s.legend) {
					if (legendValues.includes('Min')) {
						aggs.min = d3.min(data, (d) => d[s.metric]);
					}

					if (legendValues.includes('Max')) {
						aggs.max = d3.max(data, (d) => d[s.metric]);
					}

					if (legendValues.includes('Avg')) {
						aggs.avg = d3.mean(data, (d) => d[s.metric]);
					}

					if (legendValues.includes('Last')) {
						aggs.last = data[data.length - 1][s.metric];
					}

					legendEntries.push({
						color: s.lineColor ?? s.fillColor ?? 'white',
						text:
							s.label.padEnd(15, ' ') +
							legendValues.map((v) => `${v}: ${formatter(aggs[v.toLowerCase()])}`).join('')
					});
				}

				// Calculate the y scale domain if needed.
				// Will use existing values when possible.
				if (this._yMin === undefined) {
					if (s.hasOwnProperty('negativeY') && s.negativeY) {
						yDomain[0] = aggs.hasOwnProperty('max')
							? Math.min(yDomain[0], -aggs.max)
							: Math.min(yDomain[0], -d3.max(data, (d) => d[s.metric]));
					} else {
						yDomain[0] = aggs.hasOwnProperty('min')
							? Math.min(yDomain[0], aggs.min)
							: Math.min(
									yDomain[0],
									d3.min(data, (d) => d[s.metric])
								);
					}
				}

				if (this._yMax === undefined) {
					if (s.hasOwnProperty('negativeY') && s.negativeY) {
						yDomain[1] = aggs.hasOwnProperty('min')
							? Math.max(yDomain[1], -aggs.min)
							: Math.max(yDomain[1], -d3.min(data, (d) => d[s.metric]));
					} else {
						yDomain[1] = aggs.hasOwnProperty('max')
							? Math.max(yDomain[1], aggs.max)
							: Math.max(
									yDomain[1],
									d3.max(data, (d) => d[s.metric])
								);
					}
				}
			}

			if (yDomain[0] === yDomain[1]) {
				if (this._yMax !== undefined) {
					yDomain[0]--;
				} else {
					yDomain[1]++;
				}
			}

			return [yDomain, legendEntries];
		}
	}

	let ts;

	$effect(() => {
		if (ts) ts.refreshData(data);
	});

	let width;
	let height;
	let svg;

	const options = {
		data: data || [],
		// title: 'Demo',
		yMin: 0,
		series: [
			{
				label: 'ctr',
				metric: 1,
				lineColor: '#77bb41ff',
				fillColor: '#77bb4132',
				tooltip: true
			}
		]
	};

	// This contains the debounced values
	let timeoutHandle;
	$effect(() => {
		clearTimeout(timeoutHandle);
		timeoutHandle = setTimeout(() => {
			console.log('resizing', width, options.width);
			if (options.width === width) return;
			options.width = width;
			ts = new TimeSeriesChart(options);
			if (ts) ts.appendTo(svg);
		}, 200);
	});

	function initialize(svg) {
		options.width = width;
		ts = new TimeSeriesChart(options);
		ts.appendTo(svg);
	}
</script>

{#if data.length}
	<div
		class="sticky left-0"
		use:initialize
		use:resizeObserver={(element) => (width = element.clientWidth)}
		bind:this={svg}
	></div>
{/if}
