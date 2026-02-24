#!/usr/bin/env python3
"""Parse Meituan HD Pipeline CSV and create SQLite database"""

import csv
import sqlite3
import json
import os

DB_PATH = '/Users/hank/.openclaw/workspace/pipeline-visualizer/data/pipelines.db'
CSV_PATH = '/Users/hank/Downloads/1770293521225.csv'

def parse_csv(csv_path):
    """Parse the pipeline CSV file"""
    nodes = {}
    edges = []
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            app_name = row['app_name']
            successor = row['successor']
            is_deleted = int(row['is_deleted'])
            
            # Add node if not exists
            if app_name not in nodes:
                nodes[app_name] = {
                    'id': row['id'],
                    'name': app_name,
                    'app_type': int(row['app_type']) if row['app_type'] else 0,
                    'queue_type': int(row['queue_type']) if row['queue_type'] else 0,
                    'is_last': int(row['is_last_in_pipeline']),
                    'create_time': row['create_time'],
                    'create_by': row['create_by'],
                }
            
            # Add edge row['create_by only if successor exists and is_deleted1 (active)
            if successor and is_deleted == 1:
                edges.append({
                    'from': app_name,
                    'to': successor
                })
    
    return list(nodes.values()), edges

def create_database(db_path):
    """Create SQLite database schema"""
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create nodes table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS pipeline_nodes (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            app_type INTEGER DEFAULT 0,
            queue_type INTEGER DEFAULT 0,
            is_last INTEGER DEFAULT 0,
            create_time TEXT,
            create_by TEXT,
            status TEXT DEFAULT 'healthy',
            metrics TEXT
        )
    ''')
    
    # Create edges table with is_deleted column
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS pipeline_edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_node TEXT NOT NULL,
            to_node TEXT NOT NULL,
            is_deleted INTEGER DEFAULT 0,
            FOREIGN KEY (from_node) REFERENCES pipeline_nodes(name),
            FOREIGN KEY (to_node) REFERENCES pipeline_nodes(name)
        )
    ''')
    
    # Create indexes
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_edges_from ON pipeline_edges(from_node)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_edges_to ON pipeline_edges(to_node)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_edges_deleted ON pipeline_edges(is_deleted)')
    
    conn.commit()
    return conn

def insert_data(conn, nodes, edges):
    """Insert parsed data into database"""
    cursor = conn.cursor()
    
    # Insert nodes
    for node in nodes:
        try:
            cursor.execute('''
                INSERT OR REPLACE INTO pipeline_nodes 
                (id, name, app_type, queue_type, is_last, create_time, create_by, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'healthy')
            ''', (
                node['id'],
                node['name'],
                node['app_type'],
                node['queue_type'],
                node['is_last'],
                node['create_time'],
                node['create_by']
            ))
        except sqlite3.IntegrityError:
            pass
    
    # Insert edges
    for edge in edges:
        try:
            cursor.execute('''
                INSERT INTO pipeline_edges (from_node, to_node, is_deleted)
                VALUES (?, ?, 1)
            ''', (edge['from'], edge['to']))
        except sqlite3.IntegrityError:
            pass
    
    conn.commit()

def export_to_json(conn, output_path):
    """Export active edges to JSON for GitHub Pages"""
    cursor = conn.cursor()
    
    # Get all nodes
    cursor.execute('SELECT id, name, app_type, queue_type, is_last, status FROM pipeline_nodes')
    nodes = []
    for row in cursor.fetchall():
        nodes.append({
            'id': row[0],
            'name': row[1],
            'app_type': row[2],
            'queue_type': row[3],
            'is_last': row[4],
            'status': row[5]
        })
    
    # Get active edges only (is_deleted=1)
    cursor.execute('SELECT from_node, to_node FROM pipeline_edges WHERE is_deleted = 1')
    edges = []
    for row in cursor.fetchall():
        edges.append({
            'from': row[0],
            'to': row[1]
        })
    
    data = {
        'nodes': nodes,
        'edges': edges,
        'stats': {
            'total_nodes': len(nodes),
            'total_edges': len(edges)
        }
    }
    
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    
    return data

def main():
    print(f"📂 Parsing CSV: {CSV_PATH}")
    nodes, edges = parse_csv(CSV_PATH)
    
    print(f"   📊 Found {len(nodes)} nodes, {len(edges)} active edges")
    
    conn = create_database(DB_PATH)
    insert_data(conn, nodes, edges)
    
    # Export to JSON for web
    json_path = '/Users/hank/.openclaw/workspace/pipeline-visualizer/docs/pipelines.json'
    data = export_to_json(conn, json_path)
    
    print(f"✅ Database created: {DB_PATH}")
    print(f"   📊 Nodes: {data['stats']['total_nodes']}")
    print(f"   🔗 Active Edges: {data['stats']['total_edges']}")
    
    # Show app_type distribution
    cursor = conn.cursor()
    cursor.execute('SELECT app_type, COUNT(*) FROM pipeline_nodes GROUP BY app_type ORDER BY COUNT(*) DESC')
    print("\n📈 App Type Distribution:")
    for row in cursor.fetchall():
        print(f"   type {row[0]}: {row[1]} apps")
    
    conn.close()
    print(f"\n🌐 Exported to: {json_path}")

if __name__ == '__main__':
    main()
