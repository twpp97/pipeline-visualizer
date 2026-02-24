#!/usr/bin/env python3
"""Parse Meituan HD Pipeline CSV and create SQLite database"""

import csv
import sqlite3
import json
from collections import defaultdict

DB_PATH = '/Users/hank/.openclaw/workspace/pipeline-visualizer/data/pipelines.db'

def parse_csv(csv_path):
    """Parse the pipeline CSV file"""
    nodes = []
    edges = []
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            node = {
                'id': row['id'],
                'name': row['app_name'],
                'successor': row['successor'] if row['successor'] else None,
                'app_type': row['app_type'],
                'queue_type': row['queue_type'],
                'is_last': row['is_last_in_pipeline'],
                'create_time': row['create_time'],
                'create_by': row['create_by'],
            }
            nodes.append(node)
            
            if row['successor']:
                edge = {
                    'from': row['app_name'],
                    'to': row['successor']
                }
                edges.append(edge)
    
    return nodes, edges

def create_database(db_path):
    """Create SQLite database schema"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS pipeline_nodes (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            app_type INTEGER,
            queue_type INTEGER,
            is_last INTEGER,
            create_time TEXT,
            create_by TEXT,
            status TEXT DEFAULT 'healthy',
            metrics TEXT
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS pipeline_edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_node TEXT NOT NULL,
            to_node TEXT NOT NULL,
            FOREIGN KEY (from_node) REFERENCES pipeline_nodes(name),
            FOREIGN KEY (to_node) REFERENCES pipeline_nodes(name)
        )
    ''')
    
    # Create index for faster lookups
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_edges_from ON pipeline_edges(from_node)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_edges_to ON pipeline_edges(to_node)')
    
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
            pass  # Node already exists
    
    # Insert edges
    for edge in edges:
        try:
            cursor.execute('''
                INSERT INTO pipeline_edges (from_node, to_node)
                VALUES (?, ?)
            ''', (edge['from'], edge['to']))
        except sqlite3.IntegrityError:
            pass  # Edge might have duplicates
    
    conn.commit()

def main():
    csv_path = '/Users/hank/Downloads/1770293521225.csv'
    nodes, edges = parse_csv(csv_path)
    
    conn = create_database(DB_PATH)
    insert_data(conn, nodes, edges)
    
    # Print stats
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM pipeline_nodes')
    node_count = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(*) FROM pipeline_edges')
    edge_count = cursor.fetchone()[0]
    
    print(f"✅ Database created: {DB_PATH}")
    print(f"   📊 Nodes: {node_count}")
    print(f"   🔗 Edges: {edge_count}")
    
    # Show sample DAG structure
    print("\n📋 Sample Pipeline Chains:")
    
    # Find starting nodes (no predecessors)
    cursor.execute('''
        SELECT DISTINCT name FROM pipeline_nodes
        WHERE name NOT IN (SELECT to_node FROM pipeline_edges)
    ''')
    starts = cursor.fetchall()[:5]
    
    for start in starts:
        chain = [start[0]]
        current = start[0]
        for _ in range(5):  # Limit chain length
            cursor.execute('SELECT to_node FROM pipeline_edges WHERE from_node = ? LIMIT 1', (current,))
            result = cursor.fetchone()
            if result:
                chain.append(result[0])
                current = result[0]
            else:
                break
        print(f"   → {' → '.join(chain)}")
    
    conn.close()

if __name__ == '__main__':
    main()
