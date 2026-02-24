#!/usr/bin/env python3
"""FastAPI backend for Pipeline Visualizer"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import sqlite3
import json
from typing import List, Dict, Any

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = '/Users/hank/.openclaw/workspace/pipeline-visualizer/data/pipelines.db'

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.get("/")
async def read_root():
    return FileResponse('/Users/hank/.openclaw/workspace/pipeline-visualizer/dist/index.html')

@app.get("/api/pipelines")
async def get_pipelines():
    """Get all pipeline nodes and edges"""
    conn = get_db()
    
    # Get nodes
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, name, app_type, queue_type, is_last, create_time, create_by, status
        FROM pipeline_nodes
    ''')
    nodes = [dict(row) for row in cursor.fetchall()]
    
    # Get edges
    cursor.execute('SELECT from_node, to_node FROM pipeline_edges')
    edges = [{'from': row[0], 'to': row[1]} for row in cursor.fetchall()]
    
    conn.close()
    
    return {
        'nodes': nodes,
        'edges': edges,
        'stats': {
            'total_nodes': len(nodes),
            'total_edges': len(edges)
        }
    }

@app.get("/api/pipelines/{node_name}")
async def get_node_details(node_name: str):
    """Get details for a specific node"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Get node
    cursor.execute('SELECT * FROM pipeline_nodes WHERE name = ?', (node_name,))
    node = cursor.fetchone()
    
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    # Get predecessors
    cursor.execute('''
        SELECT DISTINCT from_node FROM pipeline_edges WHERE to_node = ?
    ''', (node_name,))
    predecessors = [row[0] for row in cursor.fetchall()]
    
    # Get successors
    cursor.execute('SELECT to_node FROM pipeline_edges WHERE from_node = ?', (node_name,))
    successors = [row[0] for row in cursor.fetchall()]
    
    conn.close()
    
    return {
        'node': dict(node),
        'predecessors': predecessors,
        'successors': successors
    }

@app.get("/api/pipelines/stats/summary")
async def get_stats():
    """Get pipeline statistics"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Count by app type
    cursor.execute('SELECT app_type, COUNT(*) FROM pipeline_nodes GROUP BY app_type')
    by_type = {str(row[0]): row[1] for row in cursor.fetchall()}
    
    # Count by queue type
    cursor.execute('SELECT queue_type, COUNT(*) FROM pipeline_nodes GROUP BY queue_type')
    by_queue = {str(row[0] for row in cursor.fetchall()}
    
    # Find root]): row[1 nodes (no predecessors)
    cursor.execute('''
        SELECT COUNT(*) FROM pipeline_nodes 
        WHERE name NOT IN (SELECT to_node FROM pipeline_edges)
    ''')
    root_count = cursor.fetchone()[0]
    
    # Find leaf nodes (no successors)
    cursor.execute('''
        SELECT COUNT(*) FROM pipeline_nodes 
        WHERE name NOT IN (SELECT from_node FROM pipeline_edges)
    ''')
    leaf_count = cursor.fetchone()[0]
    
    conn.close()
    
    return {
        'by_app_type': by_type,
        'by_queue_type': by_queue,
        'root_nodes': root_count,
        'leaf_nodes': leaf_count
    }

@app.get("/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3004)
