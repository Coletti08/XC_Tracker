import { useEffect } from "react";
import Alert from "react-bootstrap/Alert";
import Container from "react-bootstrap/Container";
import Nav from "react-bootstrap/Nav";
import Navbar from "react-bootstrap/Navbar";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import RecordingLayout from "./components/RecordingLayout.jsx";
import DataPage from "./pages/DataPage.jsx";
import PlaybackPage from "./pages/PlaybackPage.jsx";
import RecordingsPage from "./pages/RecordingsPage.jsx";
import { RecordingsProvider, useRecordings } from "./state/RecordingsContext.jsx";

function Dashboard() {
    const { errors, dismissErrors } = useRecordings();
    const { pathname } = useLocation();
    useEffect(() => { window.scrollTo(0, 0); }, [pathname]);


    return <>
    <Navbar className="app-navbar">
      <Container className="app-container">
        <Navbar.Brand as={Link} to="/recordings"><span className="brand-mark" aria-hidden="true">XC</span>XC Tracker</Navbar.Brand>
        <Nav><Nav.Link as={Link} to="/recordings" active>Recordings</Nav.Link></Nav>
      </Container>
    </Navbar>
    <Container as="main" className="app-container app-main">
      {errors.length > 0 && <Alert variant="danger" dismissible onClose={dismissErrors}><ul className="mb-0 ps-3">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></Alert>}
      <Routes>
        <Route path="/" element={<Navigate to="/recordings" replace/>}/>
        <Route path="/recordings" element={<RecordingsPage />}/>
        <Route path="/recordings/:id" element={<RecordingLayout />}>
          <Route index element={<PlaybackPage />}/>
          <Route path="data" element={<DataPage />}/>
        </Route>
        <Route path="*" element={<Navigate to="/recordings" replace/>}/>
      </Routes>
    </Container>
  </>;
}

export default function App() {
    return <BrowserRouter><RecordingsProvider><Dashboard /></RecordingsProvider></BrowserRouter>;
}
