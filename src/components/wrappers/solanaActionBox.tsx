/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import {For, JSX} from 'solid-js';
import {getDirection} from '../../helpers/dom/setInnerHTML';
import classNames from '../../helpers/string/classNames';
import {IconTsx} from '../iconTsx';
import {Ripple} from '../rippleTsx';
import {Dynamic} from 'solid-js/web';
import {ActionGetResponse, ActionsJson, LinkedAction} from '@solana/actions';
import {ActionsURLMapper, fetchActionsPost, getProvider, linkedActionHref} from '../../lib/richTextProcessor/solanaBlink';
import {VersionedTransaction} from '@solana/web3.js';
import {Buffer} from 'buffer';

const className = 'webpage';

function ActionBoxFooter(actions: LinkedAction[], actionUrl: URL) {
  const refs: Array<Array<HTMLInputElement | undefined>> = actions.map(
    (action) =>
      action.parameters ?
        action.parameters.map((parameter) => undefined) :
        undefined
  );
  const setRef = (el: HTMLInputElement, index: number, _index: number) => {
    refs[index][_index] = el;
  };

  const handleSubmit = async(index: number) => {
    let apiUrl = linkedActionHref(actions[index].href, actionUrl);
    if(actions[index].parameters) {
      const params = refs[index].map((elm, _index) => {
        const template = '{' + actions[index].parameters[_index].name + '}';
        const value: string = elm.value || template;
        // replace template literals
        if(apiUrl.includes(template) || apiUrl.includes(encodeURI(template))) {
          apiUrl = apiUrl.replaceAll(template, value);
          apiUrl = apiUrl.replaceAll(encodeURI(template), value);
        }
      });
    }
    const provider = getProvider();
    if(provider) {
      const resp = await provider.connect();
      const res = await fetchActionsPost(new URL(apiUrl), {
        account: resp.publicKey.toString()
      })
      if(res.transaction) {
        console.log('transaction: ', res.transaction);
        const transactionBuffer = Buffer.from(res.transaction, 'base64');
        const uint8Array = new Uint8Array(transactionBuffer);
        const transaction = VersionedTransaction.deserialize(uint8Array);
        await provider.signAndSendTransaction(transaction);
      }
    }
  }

  return (
    actions &&
    actions.length && (
      <div
        dir={getDirection()}
        class={classNames(`${className}-footer`, 'is-button')}
        style={{
          'height': 'unset',
          'pointer-events': 'unset',
          'padding': '0.1875rem 0.5rem'
        }}
      >
        <div class="reply-markup">
          <For each={actions}>
            {(item, index) =>
              item.parameters ? (
                <div>
                  <For each={item.parameters}>
                    {(parameter, _index) => (
                      <div
                        class="input-wrapper"
                        style={{'margin-top': '1rem', 'width': 'unset'}}
                      >
                        <div class="input-field">
                          <input
                            ref={(el) => setRef(el, index(), _index())}
                            class="input-field-input is-empty"
                            contentEditable
                            dir="auto"
                            data-no-linebreaks="1"
                          />
                          <div class="input-field-border"></div>
                          <label>
                            <span class="i18n">{parameter.label}</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </For>
                  <div
                    class="reply-markup-row"
                    style={{'padding-top': '0.125rem'}}
                  >
                    <button class="reply-markup-button rp" onClick={() => { handleSubmit(index()) }}>
                      <Ripple>
                        <span class="reply-markup-button-text">
                          {item.label}
                        </span>
                      </Ripple>
                    </button>
                  </div>
                </div>
              ) : (
                <div class="reply-markup-row">
                  <button class="reply-markup-button rp" onClick={() => { handleSubmit(index()) }}>
                    <Ripple>
                      <span class="reply-markup-button-text">{item.label}</span>
                    </Ripple>
                  </button>
                </div>
              )
            }
          </For>
        </div>
      </div>
    )
  );
}

function ActionBoxName(content: JSX.Element, verified?: boolean) {
  return (
    content && (
      <div dir={getDirection()} class={`${className}-name`}>
        <strong>
          {content} {verified && '✅'}
        </strong>
      </div>
    )
  );
}

function ActionBoxTitle(text: JSX.Element) {
  return (
    text && (
      <div dir={getDirection()} class={`${className}-title`}>
        <strong>{text}</strong>
      </div>
    )
  );
}

function WebPageText(props: { children: JSX.Element }) {
  return (
    <div dir={getDirection()} class={`${className}-text`}>
      {props.children}
    </div>
  );
}

function ActionBoxIcon(src: string) {
  if(!src) {
    return;
  }

  return (
    <div class={`${className}-preview-resizer`}>
      <div class={`${className}-preview`}>
        <img class="media-photo" style={{position: 'unset'}} src={src} />
      </div>
    </div>
  );
}

export default function SolanaActionBox(props: {
  actionsJson: ActionsJson;
  actionsGet: ActionGetResponse;
  verified: boolean;
  actionUrl: URL;
  ref?: (el: HTMLDivElement) => void;
}) {
  const viewButton =  ActionBoxFooter(props.actionsGet.links?.actions, props.actionUrl);
  const siteName = ActionBoxName(props.actionUrl.host, props.verified);
  const titleDiv = ActionBoxTitle(props.actionsGet.title);
  const previewResizer = ActionBoxIcon(props.actionsGet.icon);

  const contentDiv = (
    <div class={classNames(`${className}-content`, 'actions-box')}>
      {previewResizer}
      {siteName}
      {titleDiv}
      <WebPageText>{props.actionsGet.description}</WebPageText>
      {viewButton}
    </div>
  );

  const ret = (
    <Dynamic
      component={'div'}
      ref={props.ref}
      class={classNames(className, 'quote-like')}
    >
      {contentDiv}
    </Dynamic>
  );

  return ret;
}
