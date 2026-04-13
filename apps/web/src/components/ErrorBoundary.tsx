import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home, Copy, CheckCircle, Wifi, WifiOff, Lock, Server } from 'lucide-react'
import { errorTracking } from '../lib/error-tracking'

type ErrorCategory = 'network' | 'auth' | 'server' | 'unknown'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  eventId: string | null
  copied: boolean
  copiedDetails: boolean
  errorCategory: ErrorCategory
  showDetails: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      eventId: null,
      copied: false,
      copiedDetails: false,
      errorCategory: 'unknown',
      showDetails: false,
    }
  }

  categorizeError(error: Error): ErrorCategory {
    const message = error.message.toLowerCase()
    
    if (message.includes('network') || message.includes('fetch failed') || message.includes('connection')) {
      return 'network'
    }
    if (message.includes('unauthorized') || message.includes('forbidden') || message.includes('auth')) {
      return 'auth'
    }
    if (message.includes('server') || message.includes('500') || message.includes('503')) {
      return 'server'
    }
    return 'unknown'
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorInfo: null,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    
    // Capture error in Sentry
    const eventId = errorTracking.captureException(error, {
      componentStack: errorInfo.componentStack,
      type: 'react_error_boundary',
    })
    
    const errorCategory = this.categorizeError(error)
    
    this.setState({
      error,
      errorInfo,
      eventId,
      errorCategory,
    })
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      eventId: null,
      copied: false,
      copiedDetails: false,
      errorCategory: 'unknown',
      showDetails: false,
    })
    window.location.href = '/'
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      eventId: null,
      copied: false,
      copiedDetails: false,
      errorCategory: 'unknown',
      showDetails: false,
    })
  }

  handleCopyEventId = () => {
    if (this.state.eventId) {
      navigator.clipboard.writeText(this.state.eventId)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    }
  }

  handleCopyErrorDetails = () => {
    const details = {
      error: this.state.error?.toString(),
      stack: this.state.error?.stack,
      componentStack: this.state.errorInfo?.componentStack,
      eventId: this.state.eventId,
      category: this.state.errorCategory,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    }
    
    navigator.clipboard.writeText(JSON.stringify(details, null, 2))
    this.setState({ copiedDetails: true })
    setTimeout(() => this.setState({ copiedDetails: false }), 2000)
  }

  getErrorIcon() {
    switch (this.state.errorCategory) {
      case 'network':
        return WifiOff
      case 'auth':
        return Lock
      case 'server':
        return Server
      default:
        return AlertTriangle
    }
  }

  getErrorMessage() {
    switch (this.state.errorCategory) {
      case 'network':
        return {
          title: 'Network Connection Error',
          description: 'Unable to connect to the server. Please check your internet connection.',
        }
      case 'auth':
        return {
          title: 'Authentication Error',
          description: 'Your session may have expired. Please try logging in again.',
        }
      case 'server':
        return {
          title: 'Server Error',
          description: 'The server encountered an error. Our team has been notified.',
        }
      default:
        return {
          title: 'Something went wrong',
          description: 'An unexpected error occurred. We apologize for the inconvenience.',
        }
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const ErrorIcon = this.getErrorIcon()
      const errorMessage = this.getErrorMessage()

      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border-2 border-rose-200 max-w-2xl w-full p-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-rose-100 rounded-xl">
                <ErrorIcon className="w-8 h-8 text-rose-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{errorMessage.title}</h1>
                <p className="text-gray-600 mt-1">{errorMessage.description}</p>
              </div>
            </div>

            {this.state.eventId && (
              <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-200 flex items-center justify-between">
                <div>
                  <p className="text-xs text-blue-600 font-medium">Error ID (for support)</p>
                  <p className="text-sm font-mono text-blue-800">{this.state.eventId}</p>
                </div>
                <button
                  onClick={this.handleCopyEventId}
                  className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                  title="Copy error ID"
                >
                  {this.state.copied ? (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  ) : (
                    <Copy className="w-5 h-5 text-blue-600" />
                  )}
                </button>
              </div>
            )}

            {this.state.error && (
              <div className="mb-6">
                <button
                  onClick={() => this.setState({ showDetails: !this.state.showDetails })}
                  className="w-full text-left p-4 bg-gray-50 rounded-xl border border-gray-200 hover:bg-gray-100 transition-colors flex items-center justify-between"
                >
                  <span className="text-sm font-semibold text-gray-900">
                    {this.state.showDetails ? 'Hide' : 'Show'} Technical Details
                  </span>
                  <CheckCircle className={`w-4 h-4 transition-transform ${this.state.showDetails ? 'rotate-180' : ''}`} />
                </button>
                
                {this.state.showDetails && (
                  <div className="mt-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-gray-900">Error Details:</p>
                      <button
                        onClick={this.handleCopyErrorDetails}
                        className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded text-gray-700 font-medium transition-colors flex items-center gap-1"
                      >
                        {this.state.copiedDetails ? (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy All
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-sm text-gray-700 font-mono break-all">
                      {this.state.error.toString()}
                    </p>
                    {this.state.errorInfo && (
                      <details className="mt-3">
                        <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-900 font-medium">
                          Component Stack Trace
                        </summary>
                        <pre className="mt-2 text-xs text-gray-600 overflow-auto max-h-48 p-2 bg-gray-100 rounded">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                onClick={this.handleRetry}
                className="flex-1 px-6 py-3 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 transition-colors flex items-center justify-center gap-2"
                aria-label="Try again"
              >
                <RefreshCw className="w-5 h-5" />
                Try Again
              </button>
              <button
                onClick={this.handleReset}
                className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
                aria-label="Go to dashboard"
              >
                <Home className="w-5 h-5" />
                Dashboard
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
                aria-label="Reload page"
              >
                <RefreshCw className="w-5 h-5" />
                Reload
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

