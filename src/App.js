import React from 'react';
import Home from './pages/Home';
import EditorPage from './pages/EditorPage';
import { BrowserRouter ,Route,Routes} from 'react-router-dom';
import './App.css';
import { Toaster } from 'react-hot-toast';

function App() {
  return (
   <>
    <div>

      <Toaster
        position="top-center"
        toastOptions={{
          duration: 2200,
          style: {
            background: '#21222c',
            color: '#f8f8f2',
            border: '1px solid #343746',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#19c6f0', secondary: '#21222c' } },
        }}
      />
    </div>

    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home/>} />
        <Route path="/editor/:groupId" element={<EditorPage/>} />
      </Routes>
    </BrowserRouter>

   </>
  );
}

export default App;
