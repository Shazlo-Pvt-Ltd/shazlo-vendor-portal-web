import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode, type Ref } from 'react'

export type UiLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; ref?: Ref<HTMLAnchorElement> }

function PlainLink({ to, ...rest }: UiLinkProps) {
  return <a href={to} {...rest} />
}

const LinkContext = createContext<ComponentType<UiLinkProps>>(PlainLink)

/** Lets kit components render the app's router link (for example react-router's Link) for `to` props. */
export function UiLinkProvider({ component, children }: { component: ComponentType<UiLinkProps>; children: ReactNode }) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>
}

export function useUiLink() {
  return useContext(LinkContext)
}
