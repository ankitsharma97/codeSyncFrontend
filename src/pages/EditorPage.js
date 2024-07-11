import React, { useState, useEffect } from "react";
import Client from "./Client";
import Editor from "./Editor";
import { useParams, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { CiMenuBurger } from "react-icons/ci";
import { RxCross2 } from "react-icons/rx";

function EditorPage() {
  const navigate = useNavigate();

  // const BASE_URL = 'http://localhost:8000';
  const BASE_URL = "https://codesyncbackend.onrender.com";
  const { groupId } = useParams();
  const [clients, setClients] = useState([]);

  const location = useLocation();
  const { username } = location.state || {};

  const fetchClients = () => {
    fetch(`${BASE_URL}/get/${groupId}`)
      .then((response) => {
        if (response.ok) {
          return response.json();
        }
        throw response;
      })
      .then((data) => {
        const formattedClients = data.map((user) => ({
          socketId: user.socket_id,
          username: user.user_id,
        }));
        setClients(formattedClients);
      })
      .catch((error) => {
        console.error("An error occurred: ", error);
      });
  };

  useEffect(() => {
    fetchClients();
  }, [groupId]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchClients();
    }, 1000);

    return () => clearInterval(intervalId);
  }, [groupId]);

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(groupId).then(
      () => {
        toast.success("Room ID copied to clipboard");
      },
      (err) => {
        console.error("Could not copy text: ", err);
      }
    );
  };

  const handleLeaveRoom = () => {
    fetch(`${BASE_URL}/delete/${groupId}/${username}`, {
      method: "DELETE",
    }).then((response) => {
      if (response.ok) {
        toast.success("Left the room");
        navigate("/");
      } else {
        toast.error("Failed to leave the room");
      }
    });
  };

  const [open, setOpen] = useState(false);

  const handleOpen = () => {
    setOpen(!open);
  };

  return (
    <div className="mainWrap">
      <div className="logoWrap">
        <img src="/cwf3.png" alt="logo" className="logoImg" />
      </div>
      <div className="left">
        <div className="aside">
          <div className="showLogo">
            <div className="logoWrap">
              <img src="/cwf3.png" alt="logo" className="logoImg" />
            </div>
          </div>
          <div className="asideInner">
            <h3>Connected</h3>
            <div className="active">
              <div id="clist" className="clientList">
                {clients.map((client) => (
                  <Client key={client.socketId} username={client.username} />
                ))}
              </div>
            </div>
          </div>
          <button className="btn leaveBtn" onClick={handleLeaveRoom}>
            Leave Room
          </button>
          <button className="btn copyBtn" onClick={handleCopyRoomId}>
            Copy RoomId
          </button>
        </div>
      </div>
      <div className="editorWrap">
        <Editor />
      </div>

      <div className="floating-button">
        <div onClick={handleOpen}>
          <CiMenuBurger
            style={{
              fontSize: "1.5rem",
              color: "#000",
              cursor: "pointer",
            }}
          />
        </div>
      </div>
      <div className={`navbar ${open ? "open" : ""}`}>
        <div
          style={{
            textAlign: "center",
          }}
          className="asideInner"
        >
          <div
            style={{
              position: "relative",
            }}
          >
            <p
              style={{
                paddingBottom: "10px",
                borderBottom: "1px solid #000",
                fontSize: "1.5rem",
                fontWeight: "bold",
              }}
            >
              Connected
            </p>
            <div style={{ position: "absolute", right: "10px", top: "0px" }}>
                <RxCross2
                    style={{
                    fontSize: "1.5rem",
                    color: "#000",
                    cursor: "pointer",
                    }}
                    onClick={handleOpen}
                />
                </div>
          </div>
          <div className="active">
            <div id="clist" className="clientList">
              {clients.map((client) => (
                <Client key={client.socketId} username={client.username} />
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button className="btn leaveBtn" onClick={handleLeaveRoom}>
            Leave Room
          </button>
          <button className="btn copyBtn" onClick={handleCopyRoomId}>
            Copy RoomId
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditorPage;
