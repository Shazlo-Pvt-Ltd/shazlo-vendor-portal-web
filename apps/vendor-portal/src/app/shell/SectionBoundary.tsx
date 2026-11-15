import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Button, Stack, Typography } from '@mui/material'

interface Props {
  children: ReactNode
  /** When this changes (the route did), a failed section is given another chance. */
  resetKey: string
}

interface State {
  failed: boolean
  key: string
}

/**
 * Keeps one broken page from taking the navigation down with it: the page area shows a plain
 * message, the app bar and menu stay, and moving to another section clears the failure.
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
    return (
      <div role="alert">
        <Typography component="h1" variant="h4" tabIndex={-1} gutterBottom>
          This page ran into a problem
        </Typography>
        <Typography sx={{ mb: 3 }}>Nothing you saved was lost. Try again, or go to another section from the menu.</Typography>
        <Stack direction="row" spacing={2}>
          <Button variant="contained" onClick={() => this.setState({ failed: false })}>
            Try again
          </Button>
          <Button component={Link} to="/" variant="outlined">
            Go to the overview
          </Button>
        </Stack>
      </div>
    )
  }
}
