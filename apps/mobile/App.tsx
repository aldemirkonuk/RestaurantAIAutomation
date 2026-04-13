import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ScrollView, Platform } from 'react-native';
import { ConnectionTest } from './components/ConnectionTest';
import { logConfig, API_CONFIG } from './constants/Config';

export default function App() {
  // Log configuration on app start
  logConfig();

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>🍷 WineOps AI</Text>
          <Text style={styles.subtitle}>Mobile App</Text>
        </View>
        
        <View style={styles.connectionSection}>
          <ConnectionTest />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#6B1B3D',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
  },
  connectionSection: {
    marginTop: 20,
  },
});

