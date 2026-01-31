/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from 'react'

// Default width matches the default in ui-store
const SidebarWidthContext = createContext<number>(250)

export const SidebarWidthProvider = SidebarWidthContext.Provider
export const useSidebarWidth = () => useContext(SidebarWidthContext)
