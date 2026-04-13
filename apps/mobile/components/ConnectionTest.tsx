import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { API_CONFIG, logConfig } from '../constants/Config';
import api from '../services/api';
import { Platform } from 'react-native';

export function ConnectionTest() {
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    logConfig();
  }, []);

  const testConnection = async () => {
    setStatus('testing');
    setResult('');
    setError('');

    try {
      // Test basic connection - use endpoint from Config
      const response = await api.get(API_CONFIG.ENDPOINTS.AUTH.ME);
      setStatus('success');
      setResult(JSON.stringify(response.data, null, 2));
    } catch (err: any) {
      setStatus('error');
      
      if (err.response) {
        // Server responded with error
        setError(`Status: ${err.response.status}\n${JSON.stringify(err.response.data, null, 2)}`);
        setResult('✅ Connection successful! (Got error response, which means API is reachable)');
      } else if (err.request) {
        // Request made but no response
        setError('No response from server. Check:\n1. Is API Gateway running?\n2. Is URL correct?\n3. Are you on the same network?');
      } else {
        setError(err.message);
      }
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>🔌 Connection Test</Text>
        
        <View style={styles.info}>
          <Text style={styles.label}>Platform:</Text>
          <Text style={styles.value}>{Platform.OS}</Text>
        </View>
        
        <View style={styles.info}>
          <Text style={styles.label}>API URL:</Text>
          <Text style={styles.value}>{API_CONFIG.BASE_URL}</Text>
        </View>
        
        <View style={styles.info}>
          <Text style={styles.label}>WebSocket URL:</Text>
          <Text style={styles.value}>{API_CONFIG.WS_URL}</Text>
        </View>

        <TouchableOpacity
          style={[styles.button, status === 'testing' && styles.buttonDisabled]}
          onPress={testConnection}
          disabled={status === 'testing'}
        >
          <Text style={styles.buttonText}>
            {status === 'testing' ? 'Testing...' : 'Test Connection'}
          </Text>
        </TouchableOpacity>

        {status === 'success' && (
          <View style={styles.result}>
            <Text style={styles.successText}>✅ Connection Successful!</Text>
            <Text style={styles.resultText}>{result}</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.result}>
            <Text style={styles.errorText}>❌ Connection Failed</Text>
            <Text style={styles.errorDetails}>{error}</Text>
            {result && <Text style={styles.resultText}>{result}</Text>}
          </View>
        )}

        <View style={styles.tips}>
          <Text style={styles.tipsTitle}>💡 Tips:</Text>
          <Text style={styles.tip}>
            • iOS Simulator: Use localhost:4000 ✅
          </Text>
          <Text style={styles.tip}>
            • Android Emulator: Use 10.0.2.2:4000 ✅
          </Text>
          <Text style={styles.tip}>
            • Physical Device: Use your Mac's IP (find with: ifconfig)
          </Text>
          <Text style={styles.tip}>
            • Make sure API Gateway is running: cd apps/api-gateway && pnpm start:dev
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  card: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2C2C2C',
    marginBottom: 20,
  },
  info: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    width: 120,
  },
  value: {
    fontSize: 14,
    color: '#2C2C2C',
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  button: {
    backgroundColor: '#6B1B3D',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  result: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#F7F7F7',
    borderRadius: 8,
  },
  successText: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorDetails: {
    color: '#EF4444',
    fontSize: 12,
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  resultText: {
    color: '#2C2C2C',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tips: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#F4E8C1',
    borderRadius: 8,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B1B3D',
    marginBottom: 8,
  },
  tip: {
    fontSize: 12,
    color: '#2C2C2C',
    marginBottom: 4,
  },
});

