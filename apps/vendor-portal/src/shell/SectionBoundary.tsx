import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorScreen } from '../components/ErrorScreen'

interface Props {
  children: ReactNode
  /** When this changes (the route did), a failed page is given another chance. */
  resetKey: string
}

interface State {
  failed: boolean
  key: string
}

/**
 * Keeps one broken page from taking the navigation down with it: the page area shows a plain
 * message, the bars stay, and moving to another page clears the failure.
 */
export class SectionBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error(error, info.componentStack)
    }
  }

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children
    }
    return <ErrorScreen embedded onRetry={() => this.setState({ failed: false })} />
  }
}
