import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import * as d3 from 'd3'
import './App.css'

interface PipelineNode {
  id: string
  name: string
  x: number
  y: number
  app_type: number
  status: 'healthy' | 'warning' | 'error'
  is_last: string
}

interface PipelineEdge {
  from: string
  to: string
}

interface PipelineData {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  stats?: {
    total_nodes: number
    total_edges: number
  }
}

// App type info (matching AppType enum from backend)
const APP_TYPES: Record<number, { color: string; label: string; icon: string }> = {
  0: { color: '#00ff88', label: 'stage0', icon: '🔢' },
  1: { color: '#00aaff', label: 'stage1', icon: '🔢' },
  2: { color: '#ff00ff', label: 'P0 update', icon: '🚨' },
  3: { color: '#ffaa00', label: 'posefix0', icon: '📍' },
  4: { color: '#ff4444', label: 'posefix1', icon: '📍' },
  5: { color: '#aa44ff', label: 'mender case', icon: '🔧' },
  6: { color: '#44ffaa', label: 'Expired file clean', icon: '🧹' },
  7: { color: '#44aaff', label: 'release process', icon: '🚀' },
  8: { color: '#ff8844', label: 'exporter', icon: '📤' },
  9: { color: '#88ff44', label: 'create dataset', icon: '📊' },
  10: { color: '#ff4488', label: 'simcluster', icon: '🔗' },
  11: { color: '#4488ff', label: 'pointcloudedit', icon: '☁️' },
}

type D3Node = PipelineNode & { x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null; isExternal?: boolean }

export default function App() {
  const svgRef = useRef<SVGSVGElement>(null)
  const minimapRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<PipelineData | null>(null)
  const [, setLoading] = useState(true)
  const [, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [selectedAppType, setSelectedAppType] = useState<number | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<Set<number>>(
    new Set(Object.keys(APP_TYPES).map(Number))
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [zoomTransform, setZoomTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity)
  const [showParticles, setShowParticles] = useState(true)
  const [animationSpeed, setAnimationSpeed] = useState(1)
  const [showMinimap, setShowMinimap] = useState(true)
  const [highlightPath, setHighlightPath] = useState(false)
  const [pathNodes, setPathNodes] = useState<Set<string>>(new Set())

  // Calculate stats per type
  const typeStats = useMemo(() => {
    if (!data) return {}
    
    const stats: Record<number, { count: number; incoming: number; outgoing: number }> = {}
    
    Object.keys(APP_TYPES).forEach(k => {
      stats[Number(k)] = { count: 0, incoming: 0, outgoing: 0 }
    })
    
    data.nodes.forEach(n => {
      if (stats[n.app_type]) {
        stats[n.app_type].count++
      }
    })
    
    data.edges.forEach(e => {
      const fromNode = data.nodes.find(n => n.name === e.from)
      const toNode = data.nodes.find(n => n.name === e.to)
      if (fromNode && stats[fromNode.app_type]) {
        stats[fromNode.app_type].outgoing++
      }
      if (toNode && stats[toNode.app_type]) {
        stats[toNode.app_type].incoming++
      }
    })
    
    return stats
  }, [data])

  // Filtered nodes based on app_type selection
  const filteredData = useMemo(() => {
    if (!data) return null
    
    let filteredNodes = data.nodes
    let externalNodeNames = new Set<string>()
    
    if (selectedAppType !== null) {
      // Get nodes of this app_type
      const typeNodes = data.nodes.filter(n => n.app_type === selectedAppType)
      const typeNodeNames = new Set(typeNodes.map(n => n.name))
      
      // Also include external nodes that connect to this DAG (shared apps)
      const connectedNodeNames = new Set(typeNodeNames)
      data.edges.forEach(e => {
        if (typeNodeNames.has(e.from)) {
          connectedNodeNames.add(e.to)
          externalNodeNames.add(e.to)
        }
        if (typeNodeNames.has(e.to)) {
          connectedNodeNames.add(e.from)
          externalNodeNames.add(e.from)
        }
      })
      
      filteredNodes = data.nodes.filter(n => connectedNodeNames.has(n.name))
    } else if (selectedTypes.size > 0 && selectedTypes.size < Object.keys(APP_TYPES).length) {
      filteredNodes = data.nodes.filter(n => selectedTypes.has(n.app_type))
    }
    
    const filteredNodeNames = new Set(filteredNodes.map(n => n.name))
    
    // Show edges where at least one end is in filtered nodes
    const filteredEdges = data.edges.filter(e => 
      filteredNodeNames.has(e.from) || filteredNodeNames.has(e.to)
    )
    
    // Mark external nodes
    const nodesWithExternalFlag = filteredNodes.map(n => ({
      ...n,
      isExternal: externalNodeNames.has(n.name)
    }))
    
    return { nodes: nodesWithExternalFlag, edges: filteredEdges }
  }, [data, selectedAppType, selectedTypes])

  // Toggle type (for future use in filtering UI)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _toggleType = (_type: number) => {
    // const newSet = new Set(selectedTypes)
    // if (newSet.has(type)) {
    //   if (newSet.size > 1) {
    //     newSet.delete(type)
    //   }
    // } else {
    //   newSet.add(type)
    // }
    // setSelectedTypes(newSet)
  }
  void _toggleType

  const selectAll = () => setSelectedTypes(new Set(Object.keys(APP_TYPES).map(Number)))
  const selectNone = () => setSelectedTypes(new Set([...selectedTypes].slice(0, 1)))

  // Reset zoom
  const resetZoom = useCallback(() => {
    if (svgRef.current) {
      const svg = d3.select(svgRef.current)
      svg.transition().duration(750).call(
        (d3.zoom() as any).transform,
        d3.zoomIdentity
      )
    }
  }, [])

  // Focus on node
  const focusNode = useCallback((nodeName: string) => {
    if (!svgRef.current || !data) return
    const node = data.nodes.find(n => n.name === nodeName)
    if (!node || node.x === undefined || node.y === undefined) return
    
    const svg = d3.select(svgRef.current)
    const width = window.innerWidth - 280
    const height = window.innerHeight
    
    svg.transition().duration(750).call(
      (d3.zoom() as any).transform,
      d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(1.5)
        .translate(-node.x, -node.y)
    )
    setSelectedNode(nodeName)
  }, [data])

  // Export to PNG
  const exportToPNG = useCallback(() => {
    if (!svgRef.current) return
    
    const svg = svgRef.current
    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const img = new Image()
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    
    img.onload = () => {
      canvas.width = img.width * 2
      canvas.height = img.height * 2
      ctx.fillStyle = '#0a0a0f'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      
      const pngUrl = canvas.toDataURL('image/png')
      const downloadLink = document.createElement('a')
      downloadLink.href = pngUrl
      downloadLink.download = `pipeline-dag-${new Date().toISOString().split('T')[0]}.png`
      document.body.appendChild(downloadLink)
      downloadLink.click()
      document.body.removeChild(downloadLink)
      URL.revokeObjectURL(url)
    }
    
    img.src = url
  }, [])

  // Calculate path from selected node to root/leaf
  const calculatePath = useCallback((nodeName: string, direction: 'up' | 'down') => {
    if (!data) return new Set<string>()
    
    const path = new Set<string>([nodeName])
    const queue = [nodeName]
    
    while (queue.length > 0) {
      const current = queue.shift()!
      
      if (direction === 'up') {
        // Find parents (nodes that have edges TO current)
        data.edges.filter(e => e.to === current).forEach(e => {
          if (!path.has(e.from)) {
            path.add(e.from)
            queue.push(e.from)
          }
        })
      } else {
        // Find children (nodes that have edges FROM current)
        data.edges.filter(e => e.from === current).forEach(e => {
          if (!path.has(e.to)) {
            path.add(e.to)
            queue.push(e.to)
          }
        })
      }
    }
    
    return path
  }, [data])

  // Toggle path highlighting
  const togglePathHighlight = useCallback(() => {
    if (!selectedNode || !data) {
      setHighlightPath(false)
      setPathNodes(new Set())
      return
    }
    
    if (highlightPath) {
      setHighlightPath(false)
      setPathNodes(new Set())
    } else {
      const upstream = calculatePath(selectedNode, 'up')
      const downstream = calculatePath(selectedNode, 'down')
      const allPath = new Set([...upstream, ...downstream])
      setPathNodes(allPath)
      setHighlightPath(true)
    }
  }, [selectedNode, data, highlightPath, calculatePath])

  useEffect(() => {
    console.log('Fetching data...')
    setLoading(true)
    setError(null)
    fetch('/pipelines.json')
      .then(res => {
        console.log('Response status:', res.status)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(d => {
        console.log('Data loaded:', d.nodes?.length, 'nodes,', d.edges?.length, 'edges')
        if (!d.nodes || !d.edges) throw new Error('Invalid data format')
        setData(d)
        setLoading(false)
      })
      .catch(err => {
        console.error('Error loading data:', err)
        setError(err.message)
        setLoading(false)
      })
  }, [])

  // Main graph effect
  useEffect(() => {
    if (!filteredData || !svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = window.innerWidth - 280
    const height = window.innerHeight

    const { nodes, edges } = filteredData
    const nodesMap = new Map(nodes.map(n => [n.name, n]))
    const links = edges
      .map(e => ({ source: nodesMap.get(e.from)!, target: nodesMap.get(e.to)! }))
      .filter(l => l.source && l.target)

    // Create container group for zoom
    const g = svg.append('g')

    // Setup zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString())
        setZoomTransform(event.transform)
      })
    
    svg.call(zoom as any)

    // Create simulation
    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink(links).id((d: any) => d.name).distance(60))
      .force('charge', d3.forceManyBody().strength(-150))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(35))

    // Arrow marker
    svg.append('defs').selectAll('marker')
      .data(['arrow'])
      .enter()
      .append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#888')
      .attr('opacity', 0.5)

    // Draw edges
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', (d: any) => {
        if (highlightPath && selectedNode) {
          const sourceInPath = pathNodes.has(d.source.name)
          const targetInPath = pathNodes.has(d.target.name)
          if (sourceInPath && targetInPath) {
            return '#fff'
          }
        }
        // Use selected app_type color if one is selected
        if (selectedAppType !== null) {
          return APP_TYPES[selectedAppType]?.color || '#888'
        }
        return APP_TYPES[d.source.app_type]?.color || '#888'
      })
      .attr('stroke-width', (d: any) => {
        if (highlightPath && selectedNode) {
          const sourceInPath = pathNodes.has(d.source.name)
          const targetInPath = pathNodes.has(d.target.name)
          if (sourceInPath && targetInPath) {
            return 3
          }
        }
        return 1.5
      })
      .attr('stroke-opacity', (d: any) => {
        if (highlightPath && selectedNode) {
          const sourceInPath = pathNodes.has(d.source.name)
          const targetInPath = pathNodes.has(d.target.name)
          return sourceInPath && targetInPath ? 1 : 0.1
        }
        return 0.35
      })
      .attr('marker-end', 'url(#arrow)')

    // Animated particles on edges
    const particles: any[] = []
    
    if (showParticles && links.length > 0 && !highlightPath) {
      const particleGroup = g.append('g').attr('class', 'particles')
      
      links.forEach((l, i) => {
        if (i % 3 === 0) {
          const particle = particleGroup.append('circle')
            .attr('r', 3)
            .attr('fill', APP_TYPES[(l.source as D3Node).app_type]?.color || '#fff')
            .attr('opacity', 0.8)
          
          const animate = () => {
            const duration = 2000 / animationSpeed + Math.random() * 1000
            const pathLength = Math.sqrt(
              Math.pow((l.target as D3Node).x! - (l.source as D3Node).x!, 2) +
              Math.pow((l.target as D3Node).y! - (l.source as D3Node).y!, 2)
            )
            
            if (pathLength > 0) {
              particle
                .attr('cx', (l.source as D3Node).x)
                .attr('cy', (l.source as D3Node).y)
                .transition()
                .duration(duration)
                .ease(d3.easeLinear)
                .attr('cx', (l.target as D3Node).x)
                .attr('cy', (l.target as D3Node).y)
                .on('end', animate)
            }
          }
          animate()
          particles.push(particle)
        }
      })
    }

    // Draw nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, D3Node>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on('drag', (event, d) => {
          d.fx = event.x
          d.fy = event.y
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null
          d.fy = null
        }) as any)
      .on('click', (_, d) => setSelectedNode(d.name))
      .on('mouseenter', (_, d) => setHoveredNode(d.name))
      .on('mouseleave', () => setHoveredNode(null))

    // Node circle - same app_type = same color
    node.append('circle')
      .attr('r', (d: D3Node) => d.is_last === '1' ? 14 : 10)
      .attr('fill', (d: D3Node) => {
        // If app_type selected, use that color for all nodes of that type
        // External nodes use their own app_type color
        if (selectedAppType !== null) {
          if (d.app_type === selectedAppType) {
            return APP_TYPES[selectedAppType]?.color || '#888'
          }
          return APP_TYPES[d.app_type]?.color || '#888'
        }
        return APP_TYPES[d.app_type]?.color || '#888'
      })
      .attr('stroke', (d: D3Node) => {
        if (highlightPath && pathNodes.has(d.name)) {
          return '#fff'
        }
        // External nodes get a dashed border
        return d.isExternal ? '#ff6b6b' : '#fff'
      })
      .attr('stroke-width', (d: D3Node) => {
        if (highlightPath && pathNodes.has(d.name)) {
          return 4
        }
        // External nodes have thicker border
        return d.isExternal ? 3 : 2
      })
      .attr('stroke-dasharray', (d: D3Node) => d.isExternal ? '4,2' : 'none')
      .style('filter', (d: D3Node) => {
        if (d.name === hoveredNode || d.name === selectedNode) {
          const color = selectedAppType !== null && d.app_type === selectedAppType
            ? APP_TYPES[selectedAppType]?.color
            : APP_TYPES[d.app_type]?.color
          return `drop-shadow(0 0 10px ${color || '#888'})`
        }
        return 'none'
      })
      .style('opacity', (d: D3Node) => {
        if (highlightPath && !pathNodes.has(d.name)) {
          return 0.2
        }
        // External nodes slightly transparent
        const baseOpacity = d.isExternal ? 0.7 : 0.85
        return d.name === hoveredNode || d.name === selectedNode ? 1 : baseOpacity
      })

    // App type number
    node.append('text')
      .text((d: D3Node) => d.app_type)
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('fill', '#000')
      .attr('font-size', '9px')
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none')
      .style('opacity', (d: D3Node) => highlightPath && !pathNodes.has(d.name) ? 0.2 : 1)

    // Node label
    node.append('text')
      .text((d: D3Node) => d.name.replace('App', '').replace(/([A-Z])/g, ' $1').trim())
      .attr('dx', 15)
      .attr('dy', 4)
      .attr('fill', '#e0e0e0')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('pointer-events', 'none')
      .style('text-shadow', '0 1px 4px rgba(0,0,0,0.9)')
      .style('opacity', (d: D3Node) => highlightPath && !pathNodes.has(d.name) ? 0.2 : 1)

    // Update positions
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      node.attr('transform', (d: D3Node) => `translate(${d.x},${d.y})`)
    })

    return () => {
      particles.forEach(p => p.interrupt())
      simulation.stop()
    }
  }, [filteredData, hoveredNode, selectedNode, showParticles, animationSpeed, highlightPath, pathNodes])

  // Minimap effect
  useEffect(() => {
    if (!data || !minimapRef.current || !showMinimap) return

    const svg = d3.select(minimapRef.current)
    svg.selectAll('*').remove()

    const minimapWidth = 200
    const minimapHeight = 150

    // Calculate bounds
    const xExtent = d3.extent(data.nodes, d => d.x) as [number, number]
    const yExtent = d3.extent(data.nodes, d => d.y) as [number, number]
    
    const padding = 50
    const graphWidth = (xExtent[1] - xExtent[0]) + padding * 2
    const graphHeight = (yExtent[1] - yExtent[0]) + padding * 2
    
    const scale = Math.min(minimapWidth / graphWidth, minimapHeight / graphHeight) * 0.9
    
    const g = svg.append('g')
      .attr('transform', `translate(${minimapWidth/2},${minimapHeight/2}) scale(${scale}) translate(${-(xExtent[0] + xExtent[1])/2},${-(yExtent[0] + yExtent[1])/2})`)

    // Draw all edges (simplified)
    g.selectAll('line')
      .data(data.edges)
      .enter()
      .append('line')
      .attr('x1', d => data.nodes.find(n => n.name === d.from)?.x || 0)
      .attr('y1', d => data.nodes.find(n => n.name === d.from)?.y || 0)
      .attr('x2', d => data.nodes.find(n => n.name === d.to)?.x || 0)
      .attr('y2', d => data.nodes.find(n => n.name === d.to)?.y || 0)
      .attr('stroke', '#444')
      .attr('stroke-width', 1)

    // Draw all nodes
    g.selectAll('circle')
      .data(data.nodes)
      .enter()
      .append('circle')
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', 4)
      .attr('fill', d => APP_TYPES[d.app_type]?.color || '#888')
      .attr('opacity', d => selectedTypes.has(d.app_type) ? 1 : 0.3)

    // Viewport rectangle
    const mainWidth = window.innerWidth - 280
    const mainHeight = window.innerHeight
    
    svg.append('rect')
      .attr('class', 'minimap-viewport')
      .attr('x', minimapWidth/2 - (mainWidth/2 / zoomTransform.k) * scale)
      .attr('y', minimapHeight/2 - (mainHeight/2 / zoomTransform.k) * scale)
      .attr('width', (mainWidth / zoomTransform.k) * scale)
      .attr('height', (mainHeight / zoomTransform.k) * scale)
      .attr('fill', 'none')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('transform', `translate(${zoomTransform.x * scale}, ${zoomTransform.y * scale})`)

  }, [data, showMinimap, selectedTypes, zoomTransform])

  // Search results
  const searchResults = useMemo(() => {
    if (!data || searchQuery.length < 2) return []
    const lower = searchQuery.toLowerCase()
    return data.nodes
      .filter(n => 
        n.name.toLowerCase().includes(lower) ||
        n.id.toLowerCase().includes(lower)
      )
      .slice(0, 5)
  }, [data, searchQuery])

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>◈ PIPELINES</h2>
          
          {/* Search */}
          <div className="search-box">
            <input
              type="text"
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>
                ×
              </button>
            )}
          </div>
          
          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map(node => (
                <div
                  key={node.id}
                  className="search-result"
                  onClick={() => {
                    focusNode(node.name)
                    setSearchQuery('')
                  }}
                >
                  <span style={{ color: APP_TYPES[node.app_type]?.color }}>
                    {APP_TYPES[node.app_type]?.icon}
                  </span>
                  <span>{node.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* App Type Selector */}
          <div className="app-type-selector">
            <label>Select DAG:</label>
            <select 
              value={selectedAppType ?? ''} 
              onChange={(e) => setSelectedAppType(e.target.value ? Number(e.target.value) : null)}
              className="app-type-select"
            >
              <option value="">All Types</option>
              {Object.entries(APP_TYPES).map(([type, info]) => {
                const t = Number(type)
                const count = typeStats[t]?.count || 0
                return (
                  <option key={t} value={t}>
                    {info.icon} {info.label} ({count})
                  </option>
                )
              })}
            </select>
          </div>

          <div className="sidebar-actions">
            <button onClick={() => { setSelectedAppType(null); selectAll(); }}>All</button>
            <button onClick={() => { setSelectedAppType(null); selectNone(); }}>Clear</button>
          </div>
        </div>

        <div className="type-list">
          {Object.entries(APP_TYPES).map(([type, info]) => {
            const t = Number(type)
            const stats = typeStats[t]
            const isSelected = selectedAppType === t || (selectedAppType === null && selectedTypes.has(t))
            
            return (
              <div 
                key={t}
                className={`type-item ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedAppType(selectedAppType === t ? null : t)}
                style={{ '--type-color': info.color } as React.CSSProperties}
              >
                <div className="type-info">
                  <span className="type-icon" style={{ color: info.color }}>{info.icon}</span>
                  <span className="type-label">{info.label}</span>
                  <span className="type-badge">{stats?.count || 0}</span>
                </div>
                <div className="type-stats">
                  <span>in: {stats?.incoming || 0}</span>
                  <span>out: {stats?.outgoing || 0}</span>
                </div>
                <div className="type-bar">
                  <div 
                    className="type-bar-fill" 
                    style={{ 
                      width: `${((stats?.count || 0) / (data?.stats?.total_nodes || data?.nodes?.length || 1)) * 100}%`,
                      background: info.color 
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div className="sidebar-footer">
          {/* Animation controls */}
          <div className="animation-controls">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showParticles}
                onChange={(e) => setShowParticles(e.target.checked)}
              />
              <span>Data Flow Animation</span>
            </label>
            <div className="speed-control">
              <span>Speed:</span>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.5"
                value={animationSpeed}
                onChange={(e) => setAnimationSpeed(Number(e.target.value))}
              />
            </div>
          </div>
          
          {/* View controls */}
          <div className="view-controls">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showMinimap}
                onChange={(e) => setShowMinimap(e.target.checked)}
              />
              <span>Show Minimap</span>
            </label>
          </div>
          
          <div className="footer-stats">
            <div>Nodes: {filteredData?.nodes.length || 0}</div>
            <div>Edges: {filteredData?.edges.length || 0}</div>
          </div>
        </div>
      </aside>

      {/* Main Canvas */}
      <main className="main" ref={containerRef}>
        {/* Header */}
        <header className="header">
          <h1>
            <span className="icon">◈</span>
            Pipeline DAG
            {selectedAppType !== null && (
              <span className="badge" style={{ background: APP_TYPES[selectedAppType]?.color + '40', color: APP_TYPES[selectedAppType]?.color }}>
                {APP_TYPES[selectedAppType]?.icon} {APP_TYPES[selectedAppType]?.label}
              </span>
            )}
            <span className="badge">{filteredData?.nodes.length || 0} nodes</span>
          </h1>
          
          {/* Zoom controls */}
          <div className="zoom-controls">
            <button onClick={resetZoom} title="Reset view">
              ⌖
            </button>
            <button onClick={exportToPNG} title="Export to PNG">
              📷
            </button>
            <span className="zoom-level">
              {Math.round(zoomTransform.k * 100)}%
            </span>
          </div>
        </header>

        {/* SVG Canvas */}
        <svg ref={svgRef} className="canvas" width="100%" height="100%" viewBox={`0 0 ${window.innerWidth - 280} ${window.innerHeight}`} />
        
        {/* Minimap */}
        {showMinimap && (
          <div className="minimap-container">
            <svg ref={minimapRef} className="minimap" width="200" height="150" />
          </div>
        )}
      </main>

      {/* Node Details Panel */}
      {selectedNode && data && (
        <div className="details-panel">
          <div className="details-header">
            <span className="details-title">{selectedNode}</span>
            <button className="close-btn" onClick={() => setSelectedNode(null)}>×</button>
          </div>
          <div className="details-content">
            {(() => {
              const node = data.nodes.find(n => n.name === selectedNode)
              if (!node) return null
              const typeInfo = APP_TYPES[node.app_type]
              const incoming = data.edges.filter(e => e.to === selectedNode)
              const outgoing = data.edges.filter(e => e.from === selectedNode)
              
              return (
                <>
                  <div className="detail-row">
                    <span className="label">Type</span>
                    <span className="value" style={{ color: typeInfo?.color }}>
                      {typeInfo?.icon} {typeInfo?.label}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="label">ID</span>
                    <span className="value">{node.id}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Status</span>
                    <span className="value status-healthy">healthy</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Incoming</span>
                    <span className="value">{incoming.length} edges</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Outgoing</span>
                    <span className="value">{outgoing.length} edges</span>
                  </div>
                  
                  {/* Path highlight button */}
                  <button 
                    className={`path-btn ${highlightPath ? 'active' : ''}`}
                    onClick={togglePathHighlight}
                  >
                    {highlightPath ? 'Hide Path' : 'Highlight Path'}
                  </button>
                  
                  {/* Connected nodes */}
                  {incoming.length > 0 && (
                    <div className="connected-section">
                      <div className="section-label">← From</div>
                      <div className="connected-list">
                        {incoming.map(e => {
                          const fromNode = data.nodes.find(n => n.name === e.from)
                          return (
                            <div
                              key={e.from}
                              className="connected-item"
                              onClick={() => focusNode(e.from)}
                            >
                              <span style={{ color: APP_TYPES[fromNode?.app_type || 0]?.color }}>
                                {APP_TYPES[fromNode?.app_type || 0]?.icon}
                              </span>
                              {e.from}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  
                  {outgoing.length > 0 && (
                    <div className="connected-section">
                      <div className="section-label">→ To</div>
                      <div className="connected-list">
                        {outgoing.map(e => {
                          const toNode = data.nodes.find(n => n.name === e.to)
                          return (
                            <div
                              key={e.to}
                              className="connected-item"
                              onClick={() => focusNode(e.to)}
                            >
                              <span style={{ color: APP_TYPES[toNode?.app_type || 0]?.color }}>
                                {APP_TYPES[toNode?.app_type || 0]?.icon}
                              </span>
                              {e.to}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="instructions">
        <span>◈ Scroll to zoom</span>
        <span>◈ Drag to pan</span>
        <span>◈ Click node for details</span>
      </div>
    </div>
  )
}
