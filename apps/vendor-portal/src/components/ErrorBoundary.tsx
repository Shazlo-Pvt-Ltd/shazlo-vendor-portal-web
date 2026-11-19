import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorScreen } from './ErrorScreen'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

/**
 * The last line of defence: whatever a component throws, the vendor sees a plain message and a way
 * out, never a stack trace. The error itself goes to the console in development only.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error(error, info.componentStack)
    }
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <ErrorScreen onRetry={() => this.setState({ failed: false })} />
    }
    return this.props.children
  }
}
