import React from 'react';
import Avatar from 'react-avatar';

function Client({username}) {
  return (
    console.log(username),
    <div className='client'>
        <Avatar name={username} size={50} round='12px'/>
        <span className='clientName'>{username}</span>

    </div>
  )
}

export default Client