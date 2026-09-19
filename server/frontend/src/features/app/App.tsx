import { ReactNode, Suspense, lazy, useMemo, useEffect } from "react";
import {
    BrowserRouter,
    Routes,
    Route,
    Navigate,
    useNavigate,
    useLocation,
    useParams,
} from "react-router-dom";
import { Monitor, Key, Users, Settings as SettingsIcon, LayoutDashboard, Network, Bell } from "lucide-react";

// Library Components
import {
    Dashboard,
    DashboardPage,
    DashboardNavGroup,
    ConfirmProvider,
    ToastProvider,
} from "@stefgo/react-ui-components";
import { CLIENT_STATUS } from "@kasm/shared";

import Login from "../../pages/Login";
import { useTheme } from "./context/ThemeContext";
import { ThemeProvider } from "./context/ThemeProvider";
import { useAuth } from "../auth/AuthContext";
import { AuthProvider } from "../auth/AuthProvider";
import { WebSocketProvider } from "./context/WebSocketProvider";

// Hooks & Stores
import { useClientStore } from "../../stores/useClientStore";
import { useUIStore } from "../../stores/useUIStore";
import { useActivityStore } from "../../stores/useActivityStore";
import { useKeepalivedStore } from "../../stores/useKeepalivedStore";
import { LoadingIndicator } from "../../components/LoadingIndicator";
import { NotFoundCard } from "../../components/NotFoundCard";

// Page components -- loaded on demand, so a chunk only arrives when its route does. The
// previous shape built the element tree of every page on every render of the shell,
// although one of them was ever on screen.
const ManagedClients = lazy(() =>
    import("../clients/components/ManagedClients").then((m) => ({ default: m.ManagedClients })),
);
const ClientOverview = lazy(() =>
    import("../clients/components/ClientOverview").then((m) => ({ default: m.ClientOverview })),
);
const ClientEditor = lazy(() =>
    import("../clients/components/ClientEditor").then((m) => ({ default: m.ClientEditor })),
);
const AddClientWizard = lazy(() =>
    import("../clients/components/add-client/AddClientWizard").then((m) => ({
        default: m.AddClientWizard,
    })),
);
const KeepalivedDashboard = lazy(() =>
    import("../keepalived/components/KeepalivedDashboard").then((m) => ({
        default: m.KeepalivedDashboard,
    })),
);
const ClusterOverview = lazy(() =>
    import("../keepalived/components/ClusterOverview").then((m) => ({ default: m.ClusterOverview })),
);
const ActivityView = lazy(() =>
    import("../activity/components/ActivityView").then((m) => ({ default: m.ActivityView })),
);
const UserOverview = lazy(() =>
    import("../users/components/UserOverview").then((m) => ({ default: m.UserOverview })),
);
const TokenOverview = lazy(() =>
    import("../tokens/components/TokenOverview").then((m) => ({ default: m.TokenOverview })),
);
const Settings = lazy(() => import("../../pages/Settings"));

interface ProtectedRouteProps {
    children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }
    return <>{children}</>;
};

// ---------------------------------------------------------------------------
// Routes
//
// Each route takes what it needs from the stores itself. The shell used to hold
// the selected client for every page at once; now only the page that shows it does.
// ---------------------------------------------------------------------------

function ClientsRoute() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { clients, fetchClients, deleteClient } = useClientStore();

    // Every editor route knows where back is because the surface that opened it says so.
    const open = (to: string) => navigate(to, { state: { from: pathname } });

    return (
        <ManagedClients
            clients={clients}
            onSelect={(c) => (c ? navigate(`/client/${c.id}`) : navigate("/clients"))}
            onRefresh={() => {
                fetchClients();
            }}
            onDelete={(id) => deleteClient(id)}
            onAdd={() => open("/clients/new")}
            onEdit={(c) => open(`/client/${c.id}/edit`)}
        />
    );
}

function AddClientRoute() {
    const navigate = useNavigate();
    const { state } = useLocation();
    const { fetchClients, createOutboundClient } = useClientStore();
    const back = (state as { from?: string } | null)?.from ?? "/clients";

    return (
        <AddClientWizard
            onClose={() => navigate(back)}
            onCreateOutbound={(data) => createOutboundClient(data)}
            onTokenCreated={fetchClients}
        />
    );
}

/**
 * The client behind `:clientId`, or `undefined` while the store is still empty.
 *
 * Both client routes below share the miss, and both answer it the same way: by showing the
 * list rather than redirecting to it. A link to a client arrives before the client list
 * does, and a redirect would turn that race into a bounced URL.
 */
function useRouteClient() {
    const { clientId } = useParams();
    return useClientStore((s) => s.clients.find((c) => c.id === clientId));
}

function ClientDetailRoute() {
    const client = useRouteClient();
    if (!client) return <ClientsRoute />;

    return <ClientOverview client={client} />;
}

function ClientEditRoute() {
    const client = useRouteClient();
    const updateClient = useClientStore((s) => s.updateClient);
    if (!client) return <ClientsRoute />;

    return <ClientEditor client={client} onSave={updateClient} />;
}

function NotFound() {
    const { pathname } = useLocation();

    return (
        <NotFoundCard title="Page not found" backTo="/clients" backLabel="Back to clients">
            There is nothing at <code className="font-mono text-sm">{pathname}</code>.
        </NotFoundCard>
    );
}

function AppLayout() {
    const { isAuthenticated, user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const { theme, toggleTheme } = useTheme();
    const { isSidebarCollapsed, toggleSidebarCollapsed } = useUIStore();

    // Activity. The badge only signals that something needs a look: red for an unseen error,
    // yellow for an unseen warning, nothing otherwise. Info and trace events never raise it.
    // Until /me has answered nobody is known to have seen anything, so nothing counts as
    // unseen either: counting everything would flash a dot for events already looked at.
    const activity = useActivityStore((s) => s.events);
    const currentUserId = useActivityStore((s) => s.currentUserId);
    const unseen = currentUserId
        ? activity.filter((e) => !e.seenBy.includes(currentUserId))
        : [];
    const notificationsTone = unseen.some((e) => e.level === "error")
        ? "error"
        : unseen.some((e) => e.level === "warning")
            ? "warning"
            : undefined;

    // Routing Helpers
    const path = location.pathname;

    // The shell needs the clients for the sidebar badge, and every page reads the keepalived
    // readings -- the WebSocket pushes both on connect, the fetch covers a slow socket.
    const { clients, fetchClients } = useClientStore();
    const fetchStates = useKeepalivedStore((s) => s.fetchStates);

    useEffect(() => {
        if (isAuthenticated) {
            fetchClients();
            fetchStates();
        }
    }, [isAuthenticated, fetchClients, fetchStates]);

    // Stats
    const stats = useMemo(
        () => ({
            clients: {
                active: clients.filter((c) => c.status === CLIENT_STATUS.ONLINE).length,
                total: clients.length,
            },
        }),
        [clients],
    );

    // Dashboard Props. The name comes from /api/v1/me; the page used to decode it out of
    // the JWT, which lives in an httpOnly cookie now.
    const username = user?.username ?? "User";

    const logo = (
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center text-white leading-none">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-6 h-6"
            >
                {/* The glyph of public/favicon.svg, on the same gradient plate. */}
                <rect x="3" y="2" width="18" height="5" rx="1.5" />
                <rect x="3" y="17" width="18" height="5" rx="1.5" />
                <path d="M2 12h5l2-2.5 3 5 2-2.5h8" />
                <path d="M7 4.5h.01M7 19.5h.01" />
            </svg>
        </div>
    );

    const title = (
        <div className="flex flex-col">
            <h1 className="text-xl font-bold text-text-primary leading-tight">
                K<span className="text-primary">AS</span>M
            </h1>
            <span className="pt-1 text-[10px] font-mono text-text-muted -mt-1 leading-none">
                {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0"}
            </span>
        </div>
    );

    const navGroups: DashboardNavGroup[] = [
        { id: "overview" },
        { id: "resources", title: "Monitoring" },
        { id: "notification" },
        { id: "admin", title: "Administration" },
    ];

    // Navigation only. Since react-ui-components 3.0 the Dashboard does not decide what is
    // on screen; the routes below do, passed to it as children.
    const pages: DashboardPage[] = useMemo(
        () => [
            {
                id: "dashboard",
                path: "/",
                nav: {
                    groupId: "overview",
                    label: "Dashboard",
                    icon: LayoutDashboard,
                    onClick: () => navigate("/"),
                },
            },
            {
                id: "clients",
                path: ["/clients", "/client/:clientId"],
                nav: {
                    groupId: "resources",
                    label: "Clients",
                    icon: Monitor,
                    badge: `${stats.clients.active} / ${stats.clients.total}`,
                    onClick: () => navigate("/clients"),
                },
            },
            {
                id: "clusters",
                path: "/clusters",
                nav: {
                    groupId: "resources",
                    label: "VRRP Clusters",
                    icon: Network,
                    onClick: () => navigate("/clusters"),
                },
            },
            {
                id: "notifications",
                path: "/notifications",
                nav: {
                    groupId: "notification",
                    label: "Notifications",
                    icon: Bell,
                    badgeDot: notificationsTone !== undefined,
                    badgeTone: notificationsTone,
                    onClick: () => navigate("/notifications"),
                },
            },
            {
                id: "users",
                path: "/users",
                nav: {
                    groupId: "admin",
                    placement: "mobile-more",
                    label: "Users",
                    icon: Users,
                    onClick: () => navigate("/users"),
                },
            },
            {
                id: "tokens",
                path: "/tokens",
                nav: {
                    groupId: "admin",
                    placement: "mobile-more",
                    label: "Client Tokens",
                    icon: Key,
                    onClick: () => navigate("/tokens"),
                },
            },
            {
                id: "settings",
                path: "/settings",
                nav: {
                    groupId: "admin",
                    placement: "mobile-more",
                    label: "Settings",
                    icon: SettingsIcon,
                    onClick: () => navigate("/settings"),
                },
            },
        ],
        [stats, navigate, notificationsTone],
    );

    return (
        <Dashboard
            logo={logo}
            title={title}
            username={username}
            onLogout={logout}
            theme={theme}
            onToggleTheme={toggleTheme}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={toggleSidebarCollapsed}
            pages={pages}
            navGroups={navGroups}
            currentPath={path}
        >
            <Suspense fallback={<LoadingIndicator />}>
                <Routes>
                    <Route path="/" element={<KeepalivedDashboard />} />
                    <Route path="/clusters" element={<ClusterOverview />} />
                    <Route path="/clients" element={<ClientsRoute />} />
                    <Route path="/clients/new" element={<AddClientRoute />} />
                    <Route path="/client/:clientId" element={<ClientDetailRoute />} />
                    <Route path="/client/:clientId/edit" element={<ClientEditRoute />} />
                    <Route path="/notifications" element={<ActivityView />} />
                    <Route path="/users" element={<UserOverview />} />
                    <Route path="/tokens" element={<TokenOverview />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </Suspense>
        </Dashboard>
    );
}

/**
 * Toasts sit above the routes, not inside a page: they are raised from request callbacks
 * and from events that arrive over the WebSocket, both of which outlive the surface that
 * started them, so an answer arrives even if the operator has moved on to another page.
 *
 * Confirmations sit next to them for the same reason: every page asks through
 * `useConfirm()`, and the one dialog that answers lives here.
 */
function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <WebSocketProvider>
                    <ToastProvider>
                        <ConfirmProvider>
                            <AppRoutes />
                        </ConfirmProvider>
                    </ToastProvider>
                </WebSocketProvider>
            </AuthProvider>
        </ThemeProvider>
    );
}

function AppRoutes() {
    const { isAuthenticated } = useAuth();
    return (
        <BrowserRouter>
            <Routes>
                <Route
                    path="/login"
                    element={isAuthenticated ? <Navigate to="/" /> : <Login />}
                />
                <Route
                    path="/*"
                    element={
                        <ProtectedRoute>
                            <AppLayout />
                        </ProtectedRoute>
                    }
                />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
