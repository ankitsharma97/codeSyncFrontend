import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { DocsContent } from '../components/Docs';

function DocsPage() {
    const { section } = useParams();
    const navigate = useNavigate();
    return (
        <div className="docsPage">
            <header className="docsPageHead">
                <Link to="/" className="docsBack"><FiArrowLeft /> Back</Link>
                <img src="/cwf3.png" alt="CodeWithFriend" className="brandLogo" />
                <b>Guide</b>
            </header>
            <DocsContent sectionId={section} onSection={(id) => navigate(`/docs/${id}`)} />
        </div>
    );
}

export default DocsPage;
