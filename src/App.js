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
        position="top-right"
        reverseOrder={false}
        gutter={8}
        containerStyle={{}}
        containerClassName=""
        toastOptions={{
          duration: 2000,
          style: {
            background: 'rgb(0, 156, 207)',
            color: '#fff',
          },
          success: {
            style: {
              background: 'rgb(0, 156, 207)',
              color: '#fff',
            },
          },
        }}

        
      >

      </Toaster>
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
