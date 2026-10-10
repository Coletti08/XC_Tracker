import Nav from "react-bootstrap/Nav";
import { Link, Outlet, useLocation } from "react-router-dom";

export default function LiveLayout() {
  const { pathname } = useLocation();
  return (
    <>
      <Nav
        variant="tabs"
        className="mb-4"
        activeKey={pathname.endsWith("/sessions") ? "saved" : "current"}
      >
        <Nav.Item>
          <Nav.Link as={Link} to="/tracker" eventKey="current">
            Current session
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link as={Link} to="/tracker/sessions" eventKey="saved">
            Saved sessions
          </Nav.Link>
        </Nav.Item>
      </Nav>
      <Outlet />
    </>
  );
}
